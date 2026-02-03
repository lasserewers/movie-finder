import { apiFetch } from "./client";

export interface User {
  email: string;
}

export async function checkAuth(): Promise<User | null> {
  try {
    return await apiFetch<User>("/api/auth/me");
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<User> {
  const data = await apiFetch<{ email: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return { email: data.email };
}

export async function signup(email: string, password: string): Promise<User> {
  const data = await apiFetch<{ email: string }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return { email: data.email };
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
