import type { ConvoyLocationPoint } from "./supabase";

type LatLng = {
  lat: number;
  lng: number;
};

const EARTH_RADIUS_METERS = 6371000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const distanceMeters = (from: LatLng, to: LatLng): number => {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

export const findNearestTrailIndex = (location: LatLng, points: ConvoyLocationPoint[]): number => {
  let nearestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length; i += 1) {
    const candidate = { lat: points[i].latitude, lng: points[i].longitude };
    const d = distanceMeters(location, candidate);

    if (d < bestDistance) {
      bestDistance = d;
      nearestIndex = i;
    }
  }

  return nearestIndex;
};

export const trailDistanceFromIndex = (
  points: ConvoyLocationPoint[],
  fromIndex: number,
): number => {
  if (points.length < 2 || fromIndex >= points.length - 1) {
    return 0;
  }

  let distance = 0;
  for (let i = fromIndex; i < points.length - 1; i += 1) {
    distance += distanceMeters(
      { lat: points[i].latitude, lng: points[i].longitude },
      { lat: points[i + 1].latitude, lng: points[i + 1].longitude },
    );
  }

  return distance;
};

export const speedFromRecentPoints = (points: ConvoyLocationPoint[]): number => {
  if (points.length < 3) {
    return 0;
  }

  const sample = points.slice(Math.max(points.length - 8, 0));
  const first = sample[0];
  const last = sample[sample.length - 1];
  const elapsedMs = new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime();

  if (elapsedMs <= 0) {
    return 0;
  }

  let traveled = 0;
  for (let i = 0; i < sample.length - 1; i += 1) {
    traveled += distanceMeters(
      { lat: sample[i].latitude, lng: sample[i].longitude },
      { lat: sample[i + 1].latitude, lng: sample[i + 1].longitude },
    );
  }

  return traveled / (elapsedMs / 1000);
};
