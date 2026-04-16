import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from "@react-google-maps/api";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import {
  distanceMeters,
  findNearestTrailIndex,
  speedFromRecentPoints,
  trailDistanceFromIndex,
} from "./lib/geo.ts";
import { supabase, type ConvoyLocationPoint, type ConvoySession } from "./lib/supabase.ts";
import "./App.css";

type Role = "leader" | "follower";

const LOCATION_INTERVAL_MS = 2500;
const OFF_ROUTE_THRESHOLD_METERS = 45;

function App() {
  const [role, setRole] = useState<Role>("leader");
  const [sessionCodeInput, setSessionCodeInput] = useState("");
  const [session, setSession] = useState<ConvoySession | null>(null);
  const [points, setPoints] = useState<ConvoyLocationPoint[]>([]);
  const [error, setError] = useState<string>("");
  const [sharingActive, setSharingActive] = useState(false);
  const [followerLocation, setFollowerLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [distanceToTrail, setDistanceToTrail] = useState(0);
  const [sharedEtaMinutes, setSharedEtaMinutes] = useState<number | null>(null);
  const [watchPositionPermissionDenied, setWatchPositionPermissionDenied] = useState(false);

  const leaderWatchIdRef = useRef<number | null>(null);
  const followerWatchIdRef = useRef<number | null>(null);
  const sequenceRef = useRef<number>(1);
  const lastInsertTsRef = useRef<number>(0);

  const clientId = useMemo(() => {
    const key = "convoy-client-id";
    const existingId = window.localStorage.getItem(key);
    if (existingId) {
      return existingId;
    }

    const newId = crypto.randomUUID();
    window.localStorage.setItem(key, newId);
    return newId;
  }, []);

  const { isLoaded: mapReady, loadError } = useJsApiLoader({
    id: "convoy-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "",
  });

  const latestLeaderPoint = points.length > 0 ? points[points.length - 1] : null;
  const leaderCenter = latestLeaderPoint
    ? { lat: latestLeaderPoint.latitude, lng: latestLeaderPoint.longitude }
    : null;
  const mapCenter = followerLocation ?? leaderCenter ?? { lat: 25.276987, lng: 55.296249 };

  const trailPath = useMemo(
    () => points.map((point) => ({ lat: point.latitude, lng: point.longitude })),
    [points],
  );

  useEffect(() => {
    if (!session) {
      return;
    }

    const channel = supabase
      .channel(`trail-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "convoy_location_points",
          filter: `session_id=eq.${session.id}`,
        },
        (payload: RealtimePostgresInsertPayload<ConvoyLocationPoint>) => {
          const row = payload.new;
          setPoints((current) => {
            if (current.some((item) => item.id === row.id)) {
              return current;
            }

            const next = [...current, row];
            next.sort((a, b) => a.sequence_no - b.sequence_no);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const loadHistory = async () => {
      const { data, error: fetchError } = await supabase
        .from("convoy_location_points")
        .select("*")
        .eq("session_id", session.id)
        .order("sequence_no", { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const history = data ?? [];
      setPoints(history);

      if (history.length > 0) {
        sequenceRef.current = history[history.length - 1].sequence_no + 1;
      }
    };

    void loadHistory();
  }, [session]);

  useEffect(() => {
    if (role !== "follower" || !session) {
      if (followerWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(followerWatchIdRef.current);
        followerWatchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }

    followerWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setFollowerLocation(current);

        if (points.length > 2) {
          const nearestIndex = findNearestTrailIndex(current, points);
          const nearestPoint = points[nearestIndex];
          const distance = distanceMeters(current, {
            lat: nearestPoint.latitude,
            lng: nearestPoint.longitude,
          });

          setDistanceToTrail(distance);
          setIsOffRoute(distance > OFF_ROUTE_THRESHOLD_METERS);

          const remainingMeters = trailDistanceFromIndex(points, nearestIndex);
          const leaderMps = speedFromRecentPoints(points);

          if (leaderMps > 0.6) {
            setSharedEtaMinutes(Math.round((remainingMeters / leaderMps / 60) * 10) / 10);
          }
        }
      },
      (positionError) => {
        if (positionError.code === positionError.PERMISSION_DENIED) {
          setWatchPositionPermissionDenied(true);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000,
      },
    );

    return () => {
      if (followerWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(followerWatchIdRef.current);
        followerWatchIdRef.current = null;
      }
    };
  }, [points, role, session]);

  useEffect(() => {
    if (!session || role !== "leader" || !sharingActive) {
      if (leaderWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(leaderWatchIdRef.current);
        leaderWatchIdRef.current = null;
      }

      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser.");
      return;
    }

    leaderWatchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastInsertTsRef.current < LOCATION_INTERVAL_MS) {
          return;
        }

        lastInsertTsRef.current = now;

        const row = {
          session_id: session.id,
          user_id: clientId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          speed_mps:
            position.coords.speed !== null && Number.isFinite(position.coords.speed)
              ? position.coords.speed
              : null,
          heading_deg:
            position.coords.heading !== null && Number.isFinite(position.coords.heading)
              ? position.coords.heading
              : null,
          sequence_no: sequenceRef.current,
          recorded_at: new Date().toISOString(),
        };

        sequenceRef.current += 1;

        const { error: insertError } = await supabase.from("convoy_location_points").insert(row);

        if (insertError) {
          setError(insertError.message);
        }
      },
      () => {
        setWatchPositionPermissionDenied(true);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      },
    );

    return () => {
      if (leaderWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(leaderWatchIdRef.current);
        leaderWatchIdRef.current = null;
      }
    };
  }, [clientId, role, session, sharingActive]);

  const createSession = async () => {
    setError("");
    const shareCode = Math.random().toString(36).slice(2, 8).toUpperCase();

    const { data, error: createError } = await supabase
      .from("convoy_sessions")
      .insert({
        share_code: shareCode,
        leader_client_id: clientId,
        status: "active",
      })
      .select("*")
      .single();

    if (createError) {
      setError(createError.message);
      return;
    }

    setSession(data);
    setRole("leader");
    setSessionCodeInput(data.share_code);
  };

  const joinSession = async () => {
    setError("");

    if (!sessionCodeInput.trim()) {
      setError("Enter a valid session code.");
      return;
    }

    const { data, error: joinError } = await supabase
      .from("convoy_sessions")
      .select("*")
      .eq("share_code", sessionCodeInput.trim().toUpperCase())
      .eq("status", "active")
      .single();

    if (joinError) {
      setError("Session not found. Check your code.");
      return;
    }

    setSession(data);
    setRole("follower");
  };

  const stopSharing = () => {
    setSharingActive(false);
  };

  const statusText = isOffRoute
    ? "Off route: return to the highlighted trail."
    : "On route: following leader path.";

  return (
    <main className="app-shell">
      <section className="control-panel">
        <h1>Convoy Trail Follow</h1>
        <p className="subtitle">Share live path, follow exact turns, and detect route deviation.</p>

        <div className="field-grid">
          <label>
            Mode
            <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="leader">Leader</option>
              <option value="follower">Follower</option>
            </select>
          </label>

          <label>
            Session Code
            <input
              value={sessionCodeInput}
              onChange={(event) => setSessionCodeInput(event.target.value.toUpperCase())}
              placeholder="EX: 8R2KQ1"
            />
          </label>
        </div>

        <div className="action-row">
          <button onClick={() => void createSession()}>Create Session</button>
          <button onClick={() => void joinSession()}>Join Session</button>
        </div>

        {session && (
          <div className="session-card">
            <p>
              <strong>Active Session:</strong> {session.share_code}
            </p>
            <p>
              <strong>Points streamed:</strong> {points.length}
            </p>

            {role === "leader" ? (
              <div className="action-row">
                <button onClick={() => setSharingActive(true)} disabled={sharingActive}>
                  Start Sharing
                </button>
                <button onClick={stopSharing} disabled={!sharingActive}>
                  Stop Sharing
                </button>
              </div>
            ) : (
              <>
                <p className={isOffRoute ? "warning" : "ok"}>{statusText}</p>
                <p>
                  <strong>Distance to trail:</strong> {Math.round(distanceToTrail)} m
                </p>
                <p>
                  <strong>Shared ETA:</strong>{" "}
                  {sharedEtaMinutes !== null ? `${sharedEtaMinutes} min` : "Waiting for live pace"}
                </p>
              </>
            )}
          </div>
        )}

        {watchPositionPermissionDenied && (
          <p className="warning">
            Location permission was denied. Enable location to use convoy mode.
          </p>
        )}

        {error && <p className="warning">{error}</p>}
      </section>

      <section className="map-panel">
        {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
          <div className="map-placeholder">
            Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to run map rendering.
          </div>
        )}

        {loadError && <div className="map-placeholder">Google Maps failed to load.</div>}

        {mapReady && import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
          <GoogleMap
            mapContainerClassName="map"
            center={mapCenter}
            zoom={14}
            options={{
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
            }}
          >
            {trailPath.length > 1 && (
              <PolylineF
                path={trailPath}
                options={{
                  strokeColor: "#0d9488",
                  strokeOpacity: 0.95,
                  strokeWeight: 5,
                }}
              />
            )}

            {leaderCenter && <MarkerF position={leaderCenter} label="L" />}
            {followerLocation && <MarkerF position={followerLocation} label="F" />}
          </GoogleMap>
        )}
      </section>
    </main>
  );
}

export default App;
