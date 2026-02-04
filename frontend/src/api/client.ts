function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? match[1] : "";
}

const DEFAULT_TIMEOUT_MS = 20000;

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = getCsrfToken();
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
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
    // Let the auth context handle this
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
