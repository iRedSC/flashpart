import * as React from "react";
import { Boxes, ListChecks, LogOut, Settings } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "../ui/button";
import { LogoMark } from "../logo-mark";
import { cn } from "../../lib/utils";
import { triggerHaptic } from "../../lib/haptics";
import { MutationErrorBanner } from "./mutation-error-banner";

const tabs = [
  { to: "/groups", label: "Groups", icon: ListChecks },
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/settings", label: "Settings", icon: Settings },
];

type MobileShellProps = {
  onSignOut: () => void;
};

export function MobileShell({ onSignOut }: MobileShellProps) {
  const location = useLocation();
  const isCaptureRoute = location.pathname.startsWith("/capture/");

  // Keep viewport scroll locked so rubber-banding only happens inside page scroll areas.
  React.useEffect(() => {
    if (isCaptureRoute) {
      return;
    }

    const { documentElement: html, body } = document;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [isCaptureRoute]);

  // Capture is a full-screen, single-task flow: no header, no tab bar.
  if (isCaptureRoute) {
    return (
      <div className="min-h-dvh bg-slate-50 text-slate-950">
        <MutationErrorBanner />
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-950">
      <header className="z-20 shrink-0 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <h1 className="text-lg font-semibold tracking-tight">Flashpart</h1>
          </div>
          <Button
            aria-label="Sign out"
            onClick={onSignOut}
            size="icon"
            type="button"
            variant="ghost"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <MutationErrorBanner />
      <main className="box-content flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-4">
        <Outlet />
      </main>
      <nav
        aria-label="Primary"
        className="z-20 shrink-0 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="grid h-16 grid-cols-3">
          {tabs.map((tab) => (
            <NavLink
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-slate-400 transition-colors active:scale-95",
                  isActive && "text-slate-950",
                )
              }
              key={tab.to}
              onClick={() => triggerHaptic()}
              to={tab.to}
            >
              <tab.icon className="h-6 w-6" />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
