import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import App from "./App";
import { IOS_BRAVE } from "./utils/platform";

if (IOS_BRAVE) {
  document.documentElement.classList.add("ios-brave");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion={IOS_BRAVE ? "always" : "user"}>
      <App />
    </MotionConfig>
  </StrictMode>
);
