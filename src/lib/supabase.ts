import { createClient } from "@supabase/supabase-js";

export type ConvoySession = {
  id: string;
  share_code: string;
  leader_client_id: string;
  status: "active" | "ended";
  created_at: string;
};

export type ConvoyLocationPoint = {
  id: number;
  session_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  speed_mps: number | null;
  heading_deg: number | null;
  sequence_no: number;
  recorded_at: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep runtime explicit so setup issues are immediately visible.
  throw new Error("Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
