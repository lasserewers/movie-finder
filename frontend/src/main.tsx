import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "./index.css";
import App from "./App";
import AdminApp from "./AdminApp";
import { IOS_BRAVE } from "./utils/platform";

if (IOS_BRAVE) {
  document.documentElement.classList.add("ios-brave");
}

const isAdminRoute = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion={IOS_BRAVE ? "always" : "user"}>
      {isAdminRoute ? <AdminApp /> : <App />}
    </MotionConfig>
  </StrictMode>
);
