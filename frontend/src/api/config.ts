import { apiFetch } from "./client";

export interface UserConfig {
  provider_ids: number[];
  countries: string[];
  theme?: string;
}

export async function getConfig(): Promise<UserConfig> {
  return apiFetch("/api/config");
}

export async function saveConfig(config: Partial<UserConfig>): Promise<void> {
  await apiFetch("/api/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}
