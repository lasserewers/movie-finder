import { apiFetch } from "./client";

export type SubscriptionTier = "non_premium" | "free_premium" | "premium";

export interface User {
  id: string;
  email: string;
  is_admin?: boolean;
  is_active?: boolean;
  subscription_tier?: SubscriptionTier;
  email_verified?: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
}

function normalizeSubscriptionTier(value: unknown): SubscriptionTier {
  if (value === "premium") return "premium";
  if (value === "free_premium") return "free_premium";
  return "non_premium";
}

function normalizeUser(data: {
  id?: string;
  email: string;
  is_admin?: boolean;
  is_active?: boolean;
  subscription_tier?: unknown;
  email_verified?: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
}): User {
  return {
    id: data.id || "",
    email: data.email,
    is_admin: !!data.is_admin,
    is_active: data.is_active !== false,
    subscription_tier: normalizeSubscriptionTier(data.subscription_tier),
    email_verified: data.email_verified !== false,
    created_at: data.created_at ?? null,
    last_login_at: data.last_login_at ?? null,
  };
}

export async function checkAuth(): Promise<User | null> {
  try {
    const data = await apiFetch<{
      id?: string;
      email: string;
      is_admin?: boolean;
      is_active?: boolean;
      subscription_tier?: unknown;
      email_verified?: boolean;
      created_at?: string | null;
      last_login_at?: string | null;
    }>("/api/auth/me");
    return normalizeUser(data);
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const data = await apiFetch<{
    id?: string;
    email: string;
    is_admin?: boolean;
    is_active?: boolean;
    subscription_tier?: unknown;
    email_verified?: boolean;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return normalizeUser(data);
}

export interface SignupResult {
  email: string;
  requiresEmailVerification: boolean;
  user: User | null;
}

export async function signup(email: string, password: string, acceptLegal: boolean): Promise<SignupResult> {
  const data = await apiFetch<{
    id?: string;
    email: string;
    is_admin?: boolean;
    is_active?: boolean;
    subscription_tier?: unknown;
    email_verified?: boolean;
    requires_email_verification?: boolean;
  }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, accept_legal: acceptLegal }),
  });
  if (data.requires_email_verification) {
    return {
      email: data.email,
      requiresEmailVerification: true,
      user: null,
    };
  }
  return {
    email: data.email,
    requiresEmailVerification: false,
    user: normalizeUser(data),
  };
}

export async function resendSignupVerification(
  email: string
): Promise<{ emailSent: boolean; cooldownSecondsRemaining: number }> {
  const data = await apiFetch<{
    email_sent?: boolean;
    cooldown_seconds_remaining?: number;
  }>("/api/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return {
    emailSent: data.email_sent === true,
    cooldownSecondsRemaining: Math.max(0, data.cooldown_seconds_remaining || 0),
  };
}

export async function confirmSignupEmail(token: string): Promise<User> {
  const data = await apiFetch<{
    id?: string;
    email: string;
    is_admin?: boolean;
    is_active?: boolean;
    subscription_tier?: unknown;
    email_verified?: boolean;
    auto_login?: boolean;
  }>("/api/auth/confirm-signup-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  return normalizeUser(data);
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function changeEmail(currentPassword: string, newEmail: string): Promise<{ pending_email: string }> {
  return apiFetch("/api/auth/email", {
    method: "PUT",
    body: JSON.stringify({ current_password: currentPassword, new_email: newEmail }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiFetch("/api/auth/password", {
    method: "PUT",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function deleteAccount(password: string): Promise<void> {
  await apiFetch("/api/auth/delete-account", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function forgotPassword(email: string): Promise<void> {
  await apiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await apiFetch("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export async function confirmEmailChange(token: string): Promise<{ email: string; previous_email: string }> {
  return apiFetch("/api/auth/confirm-email-change", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}
