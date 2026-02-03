import { motion, AnimatePresence } from "framer-motion";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (enabled: boolean) => void;
  countryCount?: number;
}

export default function VpnPromptModal({ open, onClose, onSelect, countryCount = 1 }: Props) {
  const countryLabel = countryCount === 1 ? "country" : "countries";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[360] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl p-8 w-[min(92vw,460px)]"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors"
            >
              &times;
            </button>
            <h3 className="font-display text-xl mb-2 text-center">Do you use a VPN?</h3>
            <p className="text-sm text-muted mb-5 text-center">
              Tell us if you can stream worldwide with a VPN, or only in your selected {countryLabel}. We use this to tailor your home screen.
            </p>
            <div className="flex gap-2 max-sm:flex-col">
              <button
                onClick={() => onSelect(false)}
                className="flex-1 h-11 rounded-full border border-border bg-panel-2 text-text text-sm font-medium hover:border-accent-2 transition-colors"
              >
                No
              </button>
              <button
                onClick={() => onSelect(true)}
                className="flex-1 h-11 rounded-full border border-accent/60 bg-accent/15 text-text text-sm font-semibold hover:bg-accent/25 transition-colors"
              >
                Yes, I use VPN
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
