import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type PremiumPlanChoice = "monthly" | "yearly";

interface PremiumFeatureDescriptor {
  id: string;
  title: string;
  detail: string;
}

interface Props {
  open: boolean;
  isLoggedIn: boolean;
  features: PremiumFeatureDescriptor[];
  monthlyPriceLabel: string;
  yearlyPriceLabel: string;
  loadingPlan?: PremiumPlanChoice | null;
  checkoutError?: string;
  preferredPlan?: PremiumPlanChoice | null;
  onClose: () => void;
  onChoosePlan: (plan: PremiumPlanChoice) => void;
  onSignup?: () => void;
  onLogin?: () => void;
}

export default function PremiumShowcaseModal({
  open,
  isLoggedIn,
  features,
  monthlyPriceLabel,
  yearlyPriceLabel,
  loadingPlan = null,
  checkoutError = "",
  preferredPlan = null,
  onClose,
  onChoosePlan,
  onSignup,
  onLogin,
}: Props) {
  const [openFeatureIds, setOpenFeatureIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setOpenFeatureIds(new Set());
  }, [open, preferredPlan]);

  const handleChoosePlan = (plan: PremiumPlanChoice) => {
    onChoosePlan(plan);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[330] flex items-start sm:items-center justify-center px-3 pb-3 pt-4 sm:p-5 overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative z-10 w-[min(920px,94vw)] max-h-[82dvh] sm:max-h-[86dvh] flex flex-col overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl"
            initial={{ y: 34, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 34, scale: 0.97 }}
            transition={{ type: "spring", damping: 24, stiffness: 290 }}
          >
            <div className="relative max-h-[82dvh] sm:max-h-[86dvh] overflow-y-auto px-5 pb-6 pt-4 sm:px-7 sm:pb-8 sm:pt-6">
              <div className="sticky top-0 z-20 -mx-5 mb-3 flex justify-end bg-gradient-to-b from-panel via-panel to-transparent px-5 pb-2 pt-2 sm:-mx-7 sm:mb-4 sm:px-7">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 w-9 rounded-full border border-border bg-panel-2 text-xl text-text transition-colors hover:border-accent-2"
                  aria-label="Close premium details"
                >
                  &times;
                </button>
              </div>

              <div className="rounded-2xl border border-amber-300/35 bg-gradient-to-br from-amber-300/16 via-amber-200/8 to-orange-500/18 p-4 sm:p-6 shadow-[0_14px_50px_-28px_rgba(245,158,11,0.65)]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/45 bg-amber-200/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-100">
                    FullStreamer Premium
                  </div>
                  <div className="text-xs text-amber-100/90">
                    Cheap upgrade, big gain across all your paid services.
                  </div>
                </div>
                <h2 className="mt-3 text-xl sm:text-2xl font-display text-text">
                  Get more from every subscription and VPN region you already pay for.
                </h2>
                <p className="mt-2 text-sm text-amber-100/85 max-w-3xl">
                  FullStreamer Premium helps you browse smarter and find more of what is already available to you.
                  Stop wasting time jumping between apps and regions. Search once, filter fast, and stream more.
                </p>
              </div>

              <div className="mt-4 grid items-start gap-2 sm:grid-cols-2">
                {features.map((feature) => (
                  <div
                    key={feature.id}
                    className="self-start rounded-xl border border-amber-200/30 bg-black/15 px-3 py-2.5 text-sm text-amber-50/95"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-amber-50">{feature.title}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFeatureIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(feature.id)) {
                              next.delete(feature.id);
                            } else {
                              next.add(feature.id);
                            }
                            return next;
                          })
                        }
                        className="h-5 w-5 flex-shrink-0 rounded-full border border-amber-100/45 bg-amber-100/20 text-[11px] font-semibold text-amber-50 hover:bg-amber-100/30 transition-colors"
                        aria-label={`More info about ${feature.title}`}
                        title={`More info about ${feature.title}`}
                      >
                        i
                      </button>
                    </div>
                    {openFeatureIds.has(feature.id) && (
                      <p className="mt-2 text-xs leading-relaxed text-amber-100/85">{feature.detail}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={Boolean(loadingPlan)}
                  onClick={() => handleChoosePlan("monthly")}
                  className="rounded-xl border border-amber-100/45 bg-gradient-to-br from-amber-200/30 to-orange-400/25 px-4 py-3 text-left hover:from-amber-200/40 hover:to-orange-400/35 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="text-xs uppercase tracking-[0.07em] text-amber-100/85">Monthly Plan</div>
                  <div className="mt-1 text-lg font-semibold text-text">{monthlyPriceLabel}</div>
                  <p className="mt-1 text-xs text-amber-100/90">
                    {loadingPlan === "monthly" ? "Redirecting to checkout..." : "Flexible entry point. Cancel anytime."}
                  </p>
                </button>

                <button
                  type="button"
                  disabled={Boolean(loadingPlan)}
                  onClick={() => handleChoosePlan("yearly")}
                  className="relative rounded-xl border border-amber-100/60 bg-gradient-to-br from-amber-300/35 to-orange-500/30 px-4 py-3 text-left hover:from-amber-300/45 hover:to-orange-500/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span className="absolute right-3 top-2 inline-flex rounded-full border border-amber-100/50 bg-amber-100/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-amber-50">
                    Best Value
                  </span>
                  <div className="text-xs uppercase tracking-[0.08em] text-amber-100/85">Yearly Plan</div>
                  <div className="mt-1 text-lg font-semibold text-text">{yearlyPriceLabel}</div>
                  <p className="mt-1 text-xs text-amber-100/90">
                    {loadingPlan === "yearly"
                      ? "Redirecting to checkout..."
                      : "Lower yearly cost for always-on discovery."}
                  </p>
                </button>
              </div>
              {checkoutError && (
                <div className="mt-3 rounded-xl border border-red-400/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {checkoutError}
                </div>
              )}

              {!isLoggedIn && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onSignup}
                    className="rounded-full border border-amber-300/60 bg-gradient-to-r from-amber-300/28 to-orange-500/22 px-4 py-2 text-sm font-semibold text-text hover:border-amber-300/80 transition-colors"
                  >
                    Create free account
                  </button>
                  {onLogin && (
                    <button
                      type="button"
                      onClick={onLogin}
                      className="rounded-full border border-border bg-panel-2 px-4 py-2 text-sm text-text hover:border-amber-300/50 transition-colors"
                    >
                      I already have an account
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
