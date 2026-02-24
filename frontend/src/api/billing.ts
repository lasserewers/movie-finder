import { apiFetch } from "./client";

export type BillingPlan = "monthly" | "yearly";

export interface BillingStatusResponse {
  configured_checkout: boolean;
  configured_monthly_checkout: boolean;
  configured_yearly_checkout: boolean;
  configured_webhook: boolean;
  checkout_enabled: boolean;
  monthly_checkout_enabled: boolean;
  yearly_checkout_enabled: boolean;
  portal_enabled: boolean;
  has_paid_subscription: boolean;
  subscription_status: string | null;
}

export async function getBillingStatus(): Promise<BillingStatusResponse> {
  return apiFetch("/api/billing/status");
}

export async function createBillingCheckout(
  plan: BillingPlan,
  currency?: "EUR" | "USD" | "GBP"
): Promise<{ checkout_url: string; plan: BillingPlan; currency?: string; country?: string | null }> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined" && window.localStorage) {
    const complianceCountry = (window.localStorage.getItem("billing_compliance_country") || "")
      .trim()
      .toUpperCase();
    const complianceToken = (window.localStorage.getItem("billing_compliance_token") || "").trim();
    if (/^[A-Z]{2}$/.test(complianceCountry)) {
      headers["X-FullStreamer-Compliance-Country"] = complianceCountry;
    }
    if (complianceToken) {
      headers["X-FullStreamer-Compliance-Token"] = complianceToken;
    }
  }
  return apiFetch("/api/billing/checkout", {
    method: "POST",
    headers,
    body: JSON.stringify({ plan, currency }),
  });
}

export async function getBillingPortal(): Promise<{ portal_url: string }> {
  return apiFetch("/api/billing/portal");
}
