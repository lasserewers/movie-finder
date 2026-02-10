function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? match[1] : "";
}

const DEFAULT_TIMEOUT_MS = 20000;
const AUTH_REFRESH_PATH = "/api/auth/refresh";

type ApiRequestInit = RequestInit & {
  _retry401?: boolean;
  timeoutMs?: number;
};

let refreshPromise: Promise<boolean> | null = null;

function isRefreshEligible(url: string): boolean {
  return !(
    url.startsWith("/api/auth/login") ||
    url.startsWith("/api/auth/signup") ||
    url.startsWith("/api/auth/logout") ||
    url.startsWith("/api/auth/refresh")
  );
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(AUTH_REFRESH_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": getCsrfToken(),
        },
        credentials: "same-origin",
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: ApiRequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  const body = options.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    if (!isFormData && !hasContentType) {
      headers["Content-Type"] = "application/json";
    }
    headers["X-CSRF-Token"] = getCsrfToken();
  }

  const controller = new AbortController();
  const requestTimeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
  const externalSignal = options.signal;
  const onAbort = () => controller.abort();
  if (externalSignal) externalSignal.addEventListener("abort", onAbort);

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      credentials: options.credentials ?? "same-origin",
      signal: controller.signal,
    });
  } catch (err) {
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    window.clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Request timed out. Please try again.", 408);
    }
    throw err;
  }

  if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  window.clearTimeout(timeout);

  if (res.status === 401) {
    if (!options._retry401 && isRefreshEligible(url)) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return apiFetch<T>(url, { ...options, _retry401: true });
      }
    }
    throw new ApiError("Unauthorized", 401);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data.detail;
    let message: string;
    if (Array.isArray(detail)) {
      message = detail.map((e: { msg?: string }) => e.msg || JSON.stringify(e)).join(". ");
    } else {
      message = detail || `Request failed (${res.status})`;
    }
    throw new ApiError(message, res.status);
  }

  return res.json();
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
