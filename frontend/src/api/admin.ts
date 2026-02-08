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
  email_verified: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
  provider_count: number;
  countries: string[];
}

export interface AdminUserListResponse {
  results: AdminUser[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface AdminAuditLog {
  id: string;
  created_at?: string | null;
  action: string;
  message: string;
  reason?: string | null;
  actor_email?: string | null;
  target_email?: string | null;
}

export interface AdminAuditLogListResponse {
  results: AdminAuditLog[];
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

export async function getAdminLogs(query = "", page = 1, pageSize = 50): Promise<AdminAuditLogListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  const trimmed = query.trim();
  if (trimmed) params.set("q", trimmed);
  return apiFetch(`/api/admin/logs?${params.toString()}`);
}

export async function updateAdminUser(
  userId: string,
  body: { is_admin?: boolean; is_active?: boolean; action_reason?: string }
): Promise<{ ok: boolean; user: AdminUser }> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAdminUser(
  userId: string,
  adminPassword: string,
  actionReason: string
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/delete`, {
    method: "POST",
    body: JSON.stringify({ admin_password: adminPassword, action_reason: actionReason }),
  });
}

export async function resetAdminUserPassword(
  userId: string,
  adminPassword: string,
  newPassword: string
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify({
      admin_password: adminPassword,
      new_password: newPassword,
    }),
  });
}
