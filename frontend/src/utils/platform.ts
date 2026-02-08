export function detectIosBrave(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIosDevice =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIosDevice && /Brave/i.test(ua);
}

export const IOS_BRAVE = detectIosBrave();
