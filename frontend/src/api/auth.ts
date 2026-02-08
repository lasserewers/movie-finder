import { apiFetch } from "./client";

export interface User {
  id: string;
  email: string;
  is_admin?: boolean;
  is_active?: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
}

export async function checkAuth(): Promise<User | null> {
  try {
    return await apiFetch<User>("/api/auth/me");
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const data = await apiFetch<{ id?: string; email: string; is_admin?: boolean; is_active?: boolean }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return {
    id: data.id || "",
    email: data.email,
    is_admin: !!data.is_admin,
    is_active: data.is_active !== false,
  };
}

export async function signup(email: string, password: string): Promise<User> {
  const data = await apiFetch<{ id?: string; email: string; is_admin?: boolean; is_active?: boolean }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return {
    id: data.id || "",
    email: data.email,
    is_admin: !!data.is_admin,
    is_active: data.is_active !== false,
  };
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function changeEmail(currentPassword: string, newEmail: string): Promise<{ email: string }> {
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
