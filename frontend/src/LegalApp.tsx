type LegalSection = {
  id: string;
  title: string;
  body: string[];
};

const EFFECTIVE_DATE = "February 19, 2026";

const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    title: "1. Acceptance",
    body: [
      "By using FullStreamer, you agree to these Terms of Service and our Privacy Policy. If you do not agree, do not use the service.",
      "You must be at least 16 years old, or the minimum age required by your local law, to create an account.",
    ],
  },
  {
    id: "accounts",
    title: "2. Accounts and Security",
    body: [
      "You are responsible for keeping your account credentials private and for all activity under your account.",
      "You must provide accurate account information and keep your email address up to date.",
    ],
  },
  {
    id: "billing",
    title: "3. Subscriptions and Billing",
    body: [
      "Premium subscriptions are billed in advance on a recurring basis (monthly or yearly) unless canceled.",
      "Payments are processed by Stripe. FullStreamer does not store full card numbers or card security codes.",
      "If payment fails, premium access may be limited or removed until billing is resolved.",
      "Checkout is available only in supported regions and may be restricted to meet legal and payment-compliance obligations.",
    ],
  },
  {
    id: "sanctions",
    title: "4. Sanctions and Restricted Regions",
    body: [
      "FullStreamer does not provide paid services to, from, or within prohibited or sanctioned jurisdictions.",
      "This includes Cuba, Iran, North Korea, Syria, and the Crimea, Donetsk, and Luhansk regions of Ukraine.",
      "We may block country selection, checkout, or account access where needed to comply with legal requirements.",
    ],
  },
  {
    id: "acceptable-use",
    title: "5. Acceptable Use",
    body: [
      "Do not abuse, disrupt, reverse engineer, or attempt unauthorized access to FullStreamer systems or data.",
      "Do not use automated methods to scrape or bulk-extract FullStreamer content or APIs without written permission.",
      "Do not use FullStreamer to violate third-party rights or the terms of the streaming platforms you use.",
      "Do not attempt to bypass regional, sanctions, or payment-compliance controls.",
    ],
  },
  {
    id: "third-party-data",
    title: "6. Third-Party Data and Attribution",
    body: [
      "FullStreamer uses third-party APIs and data sources, including TMDB, Streaming Availability (via RapidAPI), and Stripe.",
      "Streaming availability can change quickly and may differ by region, account, VPN status, and provider licensing updates.",
      "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      "Streaming data is provided by JustWatch via TMDB and by Streaming Availability.",
    ],
  },
  {
    id: "ip",
    title: "7. Intellectual Property",
    body: [
      "FullStreamer software, branding, and original UI content are owned by FullStreamer unless otherwise stated.",
      "Movie, TV, logo, and provider metadata remain the property of their respective owners and licensors.",
    ],
  },
  {
    id: "disclaimer",
    title: "8. Disclaimer and Liability",
    body: [
      "FullStreamer is provided on an as-is and as-available basis without warranties of uninterrupted or error-free operation.",
      "To the extent permitted by law, FullStreamer is not liable for indirect, incidental, special, or consequential damages.",
    ],
  },
  {
    id: "termination",
    title: "9. Suspension or Termination",
    body: [
      "We may suspend or terminate access for abuse, fraud, legal risk, or serious terms violations.",
      "You may stop using the service at any time and can cancel paid subscriptions through billing management.",
    ],
  },
  {
    id: "updates",
    title: "10. Changes",
    body: [
      "We may update these terms as the product evolves. Material changes will be reflected by updating the effective date on this page.",
    ],
  },
];

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "overview",
    title: "1. Overview",
    body: [
      "This Privacy Policy explains what data FullStreamer collects, how it is used, and your choices.",
      "By using FullStreamer, you consent to the processing described in this policy.",
    ],
  },
  {
    id: "data-we-collect",
    title: "2. Data We Collect",
    body: [
      "Account data: email, password hash, account settings, subscription tier, and login/session metadata.",
      "Usage data: selected providers, selected countries, watchlist/list/watched activity, notification preferences, and linked account sync metadata.",
      "Cookies: authentication, session continuity, and CSRF protection cookies required for secure sign-in.",
      "Billing data: Stripe customer/subscription IDs and subscription status metadata. We do not store full card details.",
      "Technical data: security logs, basic request metadata, and coarse country code signals from trusted reverse-proxy headers used to operate and secure the service.",
    ],
  },
  {
    id: "how-we-use-data",
    title: "3. How We Use Data",
    body: [
      "To provide core features like discovery, personalization, saved lists, notifications, and account management.",
      "To process subscriptions and manage billing states.",
      "To secure the platform, prevent abuse, and troubleshoot reliability issues.",
      "To comply with legal obligations, including sanctions and payment-compliance requirements, and to enforce our terms.",
    ],
  },
  {
    id: "third-parties",
    title: "4. Third-Party Services",
    body: [
      "TMDB and Streaming Availability provide entertainment metadata and availability data used in FullStreamer features.",
      "Stripe processes payments and customer billing portal workflows.",
      "Payment providers may perform their own compliance checks and restrict transactions where legally required.",
      "Letterboxd import features use your export files when you upload them for sync operations.",
    ],
  },
  {
    id: "compliance",
    title: "5. Compliance and Regional Restrictions",
    body: [
      "We use coarse location signals and account settings to enforce legal and payment-compliance restrictions.",
      "If your location is in a prohibited or sanctioned region, some features including paid checkout may be unavailable.",
      "We do not knowingly provide paid services in Cuba, Iran, North Korea, Syria, or the Crimea, Donetsk, and Luhansk regions of Ukraine.",
    ],
  },
  {
    id: "retention",
    title: "6. Data Retention",
    body: [
      "We keep account and feature data while your account is active, and for a limited period afterward when needed for security, audit, or legal purposes.",
      "You can request account deletion. Some records may be retained where required by law or fraud-prevention needs.",
    ],
  },
  {
    id: "security",
    title: "7. Security",
    body: [
      "We use reasonable technical and organizational safeguards to protect stored data.",
      "No internet system is perfectly secure, so absolute security cannot be guaranteed.",
    ],
  },
  {
    id: "your-rights",
    title: "8. Your Rights and Choices",
    body: [
      "You can update account preferences and linked-data settings from within the app.",
      "You can request account deletion and data export requests by contacting legal@fullstreamer.com.",
      "If local privacy laws apply to you, you may have additional rights such as access, correction, deletion, objection, or portability.",
    ],
  },
  {
    id: "international",
    title: "9. International Transfers",
    body: [
      "Your data may be processed in countries other than your own. We take reasonable steps to protect data during such transfers.",
    ],
  },
  {
    id: "policy-updates",
    title: "10. Policy Updates",
    body: [
      "We may update this policy as services and legal requirements evolve. Material updates are reflected by changing the effective date.",
    ],
  },
];

function legalTypeFromPath(pathname: string): "terms" | "privacy" {
  const path = pathname.toLowerCase();
  if (path === "/privacy" || path.startsWith("/privacy/") || path.includes("/privacy")) {
    return "privacy";
  }
  return "terms";
}

export default function LegalApp() {
  const legalType = legalTypeFromPath(window.location.pathname);
  const isTerms = legalType === "terms";
  const title = isTerms ? "Terms of Service" : "Privacy Policy";
  const subtitle = isTerms
    ? "Rules for using FullStreamer and subscription services."
    : "How FullStreamer collects, uses, and protects personal data.";
  const sections = isTerms ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <div className="min-h-screen text-text">
      <main className="page-container py-8 sm:py-10 lg:py-12">
        <div className="mx-auto max-w-4xl rounded-2xl border border-border bg-panel/95 shadow-[0_20px_65px_-35px_rgba(0,0,0,0.65)]">
          <div className="border-b border-border px-5 py-5 sm:px-8 sm:py-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <a
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-bg/40 px-3 py-1.5 text-xs font-semibold text-muted hover:text-text hover:border-accent-2 transition-colors"
              >
                ← Back to FullStreamer
              </a>
              <div className="flex items-center gap-2 text-xs">
                <a
                  href="/terms"
                  className={`rounded-full border px-3 py-1.5 font-semibold transition-colors ${
                    isTerms
                      ? "border-accent/60 bg-accent/20 text-text"
                      : "border-border/80 bg-bg/40 text-muted hover:text-text hover:border-accent-2"
                  }`}
                >
                  Terms
                </a>
                <a
                  href="/privacy"
                  className={`rounded-full border px-3 py-1.5 font-semibold transition-colors ${
                    !isTerms
                      ? "border-accent/60 bg-accent/20 text-text"
                      : "border-border/80 bg-bg/40 text-muted hover:text-text hover:border-accent-2"
                  }`}
                >
                  Privacy
                </a>
              </div>
            </div>

            <h1 className="mt-4 font-display text-3xl sm:text-4xl">{title}</h1>
            <p className="mt-2 text-sm text-muted">{subtitle}</p>
            <p className="mt-2 text-xs text-muted">Effective date: {EFFECTIVE_DATE}</p>
          </div>

          <div className="space-y-7 px-5 py-6 sm:px-8 sm:py-8">
            {sections.map((section) => (
              <section key={section.id} className="space-y-2">
                <h2 className="text-base font-semibold text-text">{section.title}</h2>
                {section.body.map((line, idx) => (
                  <p key={`${section.id}:${idx}`} className="text-sm leading-6 text-muted">
                    {line}
                  </p>
                ))}
              </section>
            ))}

            <section className="space-y-2 rounded-xl border border-border/80 bg-bg/35 p-4">
              <h2 className="text-base font-semibold text-text">Contact</h2>
              <p className="text-sm leading-6 text-muted">
                Legal and privacy questions:{" "}
                <a className="text-accent-2 underline underline-offset-2" href="mailto:legal@fullstreamer.com">
                  legal@fullstreamer.com
                </a>
              </p>
              <p className="text-sm leading-6 text-muted">
                Billing questions:{" "}
                <a className="text-accent-2 underline underline-offset-2" href="mailto:billing@fullstreamer.com">
                  billing@fullstreamer.com
                </a>
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
