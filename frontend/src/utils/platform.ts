export function detectIosBrave(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIosDevice =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIosDevice) return false;

  const braveNavigator = navigator as Navigator & {
    brave?: { isBrave?: () => Promise<boolean> };
  };
  const hasBraveApi = !!(braveNavigator.brave && typeof braveNavigator.brave.isBrave === "function");
  const uaSignalsBrave = /Brave\/\d+/i.test(ua) || /\bBrave\b/i.test(ua);

  let forcedLiteMode = false;
  try {
    const params = new URLSearchParams(window.location.search);
    const liteParam = params.get("ios_lite");
    if (liteParam === "1") localStorage.setItem("ios_lite_mode", "1");
    if (liteParam === "0") localStorage.removeItem("ios_lite_mode");
    forcedLiteMode = localStorage.getItem("ios_lite_mode") === "1";
  } catch {
    forcedLiteMode = false;
  }

  return forcedLiteMode || hasBraveApi || uaSignalsBrave;
}

export const IOS_BRAVE = detectIosBrave();
