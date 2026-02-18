export type BillingCurrency = "EUR" | "USD" | "GBP";
export type BillingPlan = "monthly" | "yearly";

const COUNTRY_TO_CURRENCY: Record<string, BillingCurrency> = {
  US: "USD",
  GB: "GBP",
  UK: "GBP",
};

const PLAN_PRICE_BY_CURRENCY: Record<BillingCurrency, Record<BillingPlan, number>> = {
  EUR: { monthly: 2.5, yearly: 25 },
  USD: { monthly: 3.0, yearly: 30 },
  GBP: { monthly: 2.5, yearly: 25 },
};

function normalizeCountryCode(countryCode: string | null | undefined): string {
  return (countryCode || "").trim().toUpperCase();
}

export function billingCurrencyForCountry(countryCode: string | null | undefined): BillingCurrency {
  const normalized = normalizeCountryCode(countryCode);
  return COUNTRY_TO_CURRENCY[normalized] || "EUR";
}

function formatMoney(amount: number, currency: BillingCurrency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function premiumPriceLabelsForCountry(countryCode: string | null | undefined): {
  currency: BillingCurrency;
  monthlyLabel: string;
  yearlyLabel: string;
} {
  const currency = billingCurrencyForCountry(countryCode);
  const monthly = PLAN_PRICE_BY_CURRENCY[currency].monthly;
  const yearly = PLAN_PRICE_BY_CURRENCY[currency].yearly;
  return {
    currency,
    monthlyLabel: `${formatMoney(monthly, currency)} / month`,
    yearlyLabel: `${formatMoney(yearly, currency)} / year`,
  };
}
