import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import App from "./App";

function detectIosBrave() {
  const ua = navigator.userAgent || "";
  const isIosDevice =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIosDevice && /Brave/i.test(ua);
}

const isIosBrave = detectIosBrave();
if (isIosBrave) {
  document.documentElement.classList.add("ios-brave");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion={isIosBrave ? "always" : "user"}>
      <App />
    </MotionConfig>
  </StrictMode>
);
