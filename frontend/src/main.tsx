import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import App from "./App";
import AdminApp from "./AdminApp";
import ResetPasswordApp from "./ResetPasswordApp";
import ConfirmEmailApp from "./ConfirmEmailApp";
import ConfirmSignupEmailApp from "./ConfirmSignupEmailApp";
import LegalApp from "./LegalApp";
import { IOS_BRAVE } from "./utils/platform";

if (IOS_BRAVE) {
  document.documentElement.classList.add("ios-brave");
}

const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const isResetPasswordRoute =
  window.location.pathname === "/reset-password" ||
  window.location.pathname.startsWith("/reset-password/");
const isConfirmEmailRoute =
  window.location.pathname === "/confirm-email" ||
  window.location.pathname.startsWith("/confirm-email/");
const isConfirmSignupEmailRoute =
  window.location.pathname === "/confirm-signup-email" ||
  window.location.pathname.startsWith("/confirm-signup-email/");
const isLegalRoute =
  window.location.pathname === "/terms" ||
  window.location.pathname.startsWith("/terms/") ||
  window.location.pathname === "/privacy" ||
  window.location.pathname.startsWith("/privacy/") ||
  window.location.pathname === "/legal" ||
  window.location.pathname.startsWith("/legal/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion={IOS_BRAVE ? "always" : "user"}>
      {isAdminRoute ? (
        <AdminApp />
      ) : isResetPasswordRoute ? (
        <ResetPasswordApp />
      ) : isConfirmEmailRoute ? (
        <ConfirmEmailApp />
      ) : isConfirmSignupEmailRoute ? (
        <ConfirmSignupEmailApp />
      ) : isLegalRoute ? (
        <LegalApp />
      ) : (
        <App />
      )}
    </MotionConfig>
  </StrictMode>
);
