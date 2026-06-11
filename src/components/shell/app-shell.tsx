import { Navigate } from "react-router-dom";
import type { AuthSession } from "../../lib/auth-session";
import { useIsMobile } from "../../lib/use-is-mobile";
import { DesktopShell } from "./desktop-shell";
import { MobileShell } from "./mobile-shell";

/**
 * Desktop / mobile split
 * ----------------------
 * The app has ONE router and ONE set of pages, but TWO shells. This component
 * is the only place that picks between them, using `useIsMobile()`
 * (src/lib/use-is-mobile.ts):
 *
 * - DesktopShell: top header + horizontal nav. The ops console (products
 *   table, settings, Shopify).
 * - MobileShell: compact header + bottom tab bar, capture-first. Capture
 *   routes (/capture/:groupId) render full-screen without any chrome.
 *
 * Pages are shared and adapt with responsive Tailwind classes. Do not branch
 * on user agent or window width anywhere else - use `useIsMobile()` if a page
 * truly needs device-specific behavior (e.g. RootRedirect below).
 */

type AppShellProps = {
  session: AuthSession;
  onSignOut: () => void;
};

export function AppShell({ onSignOut, session }: AppShellProps) {
  const isMobile = useIsMobile();

  return isMobile ? (
    <MobileShell onSignOut={onSignOut} />
  ) : (
    <DesktopShell onSignOut={onSignOut} session={session} />
  );
}

/**
 * Mobile installs land on Groups (the capture entry point); desktop lands on
 * the Products ops table.
 */
export function RootRedirect() {
  const isMobile = useIsMobile();

  return <Navigate replace to={isMobile ? "/groups" : "/products"} />;
}
