import { apiFetch } from "./client";

export interface AdminOverview {
  total_users: number;
  active_users: number;
  admin_users: number;
  new_users_last_7_days: number;
  logins_last_24h: number;
}

export interface AdminUser {
  id: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
  provider_count: number;
  countries: string[];
  theme: string;
}

export interface AdminUserListResponse {
  results: AdminUser[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export async function getAdminMe(): Promise<{ id: string; email: string; is_admin: boolean; is_active: boolean }> {
  return apiFetch("/api/admin/me");
}

export async function getAdminOverview(): Promise<AdminOverview> {
  return apiFetch("/api/admin/overview");
}

export async function getAdminUsers(query = "", page = 1, pageSize = 25): Promise<AdminUserListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  const trimmed = query.trim();
  if (trimmed) params.set("q", trimmed);
  return apiFetch(`/api/admin/users?${params.toString()}`);
}

export async function updateAdminUser(
  userId: string,
  body: { is_admin?: boolean; is_active?: boolean }
): Promise<{ ok: boolean; user: AdminUser }> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAdminUser(
  userId: string,
  adminPassword: string
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/delete`, {
    method: "POST",
    body: JSON.stringify({ admin_password: adminPassword }),
  });
}
