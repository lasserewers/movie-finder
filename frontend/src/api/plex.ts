import { apiFetch } from "./client";

export interface PlexStatus {
  connected: boolean;
  server_name: string | null;
  item_count: number | null;
  sync_status: string | null;
  sync_message: string | null;
  last_sync_at: string | null;
  webhook_secret: string | null;
}

export interface PlexPinResponse {
  pin_id: number;
  auth_url: string;
}

export interface PlexAuthCallbackResponse {
  authenticated: boolean;
  server_name?: string;
  sections?: Array<{ key: string; title: string; type: string }>;
}

export async function getPlexStatus(): Promise<PlexStatus> {
  return apiFetch<PlexStatus>("/api/plex/status");
}

export async function createPlexPin(redirectUri: string): Promise<PlexPinResponse> {
  return apiFetch<PlexPinResponse>("/api/plex/auth/pin", {
    method: "POST",
    body: JSON.stringify({ redirect_uri: redirectUri }),
  });
}

export async function checkPlexPin(pinId: number): Promise<PlexAuthCallbackResponse> {
  return apiFetch<PlexAuthCallbackResponse>("/api/plex/auth/callback", {
    method: "POST",
    body: JSON.stringify({ pin_id: pinId }),
  });
}

export async function syncPlexLibrary(): Promise<{ ok: boolean; message: string }> {
  return apiFetch("/api/plex/sync", { method: "POST" });
}

export async function disconnectPlex(): Promise<{ ok: boolean }> {
  return apiFetch("/api/plex/disconnect", { method: "DELETE" });
}
