interface Props {
  className?: string;
  showGuestPrompt?: boolean;
  onLoginClick?: () => void;
}

export default function HeroSection({ className = "", showGuestPrompt = false, onLoginClick }: Props) {
  return (
    <section className={`mb-10 ${className}`}>
      <h2 className="font-display text-[clamp(1.5rem,2vw,2rem)] mb-1.5">
        Stream smarter, anywhere in the world.
      </h2>
      <p className="text-muted text-sm max-w-md">
        Compare streaming availability across services and countries, all in one place.
      </p>
      {showGuestPrompt && (
        <div className="mt-3 sm:mt-4 max-w-[640px] rounded-xl border border-accent/40 bg-accent/10 p-3 sm:p-4">
          <p className="text-sm text-text">
            Log in or sign up to unlock your curated home screen and search only titles you can actually stream.
          </p>
          <button
            onClick={onLoginClick}
            className="mt-2.5 h-9 px-4 rounded-full border border-accent/60 bg-accent/15 text-sm font-semibold text-text hover:bg-accent/25 transition-colors"
          >
            Log in / Sign up
          </button>
        </div>
      )}
    </section>
  );
}
