import { apiFetch } from "./client";

export type NotificationMediaType = "movie" | "tv";

export type NotificationConditionType =
  | "available_primary"
  | "stream_primary"
  | "stream_vpn"
  // Legacy values (for previously created subscriptions/notifications)
  | "stream_home_country"
  | "stream_my_services_primary"
  | "stream_my_services_any";

export type NotificationDelivery = "in_app" | "email" | "both";

export interface NotificationOption {
  condition_type: NotificationConditionType;
  label: string;
  description: string;
  currently_met: boolean;
  already_subscribed: boolean;
  active_subscription_id?: string | null;
}

export interface NotificationOptionsResponse {
  media_type: NotificationMediaType;
  tmdb_id: number;
  show_button: boolean;
  scenario: string;
  cta_text: string;
  options: NotificationOption[];
  summary: {
    primary_countries: string[];
    home_country: string;
    configured_services: boolean;
    available_in_primary: boolean;
    stream_in_primary: boolean;
    stream_anywhere?: boolean;
    stream_on_my_services_primary: boolean;
    stream_on_my_services_any: boolean;
  };
}

export interface NotificationSubscription {
  id: string;
  media_type: NotificationMediaType;
  tmdb_id: number;
  title: string;
  poster_path?: string | null;
  condition_type: NotificationConditionType;
  condition_label: string;
  deliver_in_app: boolean;
  deliver_email: boolean;
  is_active: boolean;
  created_at?: string | null;
  triggered_at?: string | null;
}

export interface NotificationSubscriptionsResponse {
  results: NotificationSubscription[];
}

export interface UserNotification {
  id: string;
  media_type: NotificationMediaType;
  tmdb_id: number;
  title: string;
  poster_path?: string | null;
  condition_type: NotificationConditionType;
  message: string;
  is_read: boolean;
  created_at?: string | null;
  read_at?: string | null;
}

export interface NotificationsResponse {
  results: UserNotification[];
  unread_count: number;
  active_alerts: number;
}

export interface NotificationSettingsResponse {
  delivery: NotificationDelivery;
  deliver_in_app: boolean;
  deliver_email: boolean;
  updated_subscriptions?: number;
}

export async function getNotificationOptions(
  mediaType: NotificationMediaType,
  tmdbId: number
): Promise<NotificationOptionsResponse> {
  return apiFetch(`/api/notifications/options/${mediaType}/${tmdbId}`);
}

export async function createNotificationSubscription(body: {
  media_type: NotificationMediaType;
  tmdb_id: number;
  title: string;
  poster_path?: string | null;
  condition_type: NotificationConditionType;
  delivery?: NotificationDelivery;
}): Promise<{ ok: boolean; already_exists: boolean; subscription: NotificationSubscription }> {
  return apiFetch("/api/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function cancelNotificationSubscription(
  subscriptionId: string
): Promise<{ ok: boolean; cancelled: boolean }> {
  return apiFetch(`/api/notifications/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "DELETE",
  });
}

export async function listNotificationSubscriptions(): Promise<NotificationSubscriptionsResponse> {
  return apiFetch("/api/notifications/subscriptions");
}

export async function updateNotificationSubscription(
  subscriptionId: string,
  conditionType: NotificationConditionType
): Promise<{ ok: boolean; subscription: NotificationSubscription; switched_to_existing?: boolean }> {
  return apiFetch(`/api/notifications/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ condition_type: conditionType }),
  });
}

export async function getNotifications(params?: {
  limit?: number;
  unreadOnly?: boolean;
  refresh?: boolean;
}): Promise<NotificationsResponse> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(Math.max(1, Math.min(200, params.limit))));
  if (params?.unreadOnly) query.set("unread_only", "1");
  if (params?.refresh !== undefined) query.set("refresh", params.refresh ? "1" : "0");
  const suffix = query.toString();
  return apiFetch(`/api/notifications${suffix ? `?${suffix}` : ""}`);
}

export async function getNotificationSettings(): Promise<NotificationSettingsResponse> {
  return apiFetch("/api/notifications/settings");
}

export async function updateNotificationSettings(
  delivery: NotificationDelivery
): Promise<NotificationSettingsResponse & { ok: boolean }> {
  return apiFetch("/api/notifications/settings", {
    method: "PUT",
    body: JSON.stringify({ delivery }),
  });
}

export async function markNotificationRead(notificationId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
  });
}

export async function deleteNotification(notificationId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/notifications/${encodeURIComponent(notificationId)}`, {
    method: "DELETE",
  });
}

export async function markAllNotificationsRead(): Promise<{ ok: boolean; updated: number }> {
  return apiFetch("/api/notifications/read-all", {
    method: "POST",
  });
}
