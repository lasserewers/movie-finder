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
