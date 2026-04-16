# Convoy Trail Follow MVP

Desktop-first prototype for real-time convoy navigation with Supabase and Google Maps.

## What This MVP Includes

- Leader creates a session and shares a short code.
- Follower joins by code and watches the exact traveled trail in real time.
- Deviation alert when follower drifts from leader trail.
- Shared ETA estimate based on the leader's recent speed.

## Tech Stack

- React + TypeScript + Vite
- Supabase Postgres + Realtime
- Google Maps JavaScript API

## 1. Configure Supabase

1. Create a Supabase project.
2. Open SQL editor and run [supabase/schema.sql](supabase/schema.sql).
3. In Supabase dashboard, confirm Realtime is enabled for `convoy_location_points`.

## 2. Configure Environment Variables

1. Copy `.env.example` to `.env`.
2. Fill in these values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_GOOGLE_MAPS_API_KEY=YOUR_GOOGLE_MAPS_JS_API_KEY
```

## 3. Run Locally

```bash
npm install
npm run dev
```

Open the app in two browser windows:

1. Window A: `Leader` mode -> `Create Session` -> `Start Sharing`
2. Window B: `Follower` mode -> enter session code -> `Join Session`

## Notes

- This version uses open RLS policies for rapid prototyping.
- Before production, add auth-based policies and session ownership checks.
