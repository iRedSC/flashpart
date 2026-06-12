import { Boxes, ListChecks, Settings } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { Button } from "../ui/button";
import { LogoMark } from "../logo-mark";
import { cn } from "../../lib/utils";
import type { AuthSession } from "../../lib/auth-session";
import { MutationErrorBanner } from "./mutation-error-banner";

const navigation = [
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/groups", label: "Groups", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings },
];

type DesktopShellProps = {
  session: AuthSession;
  onSignOut: () => void;
};

export function DesktopShell({ onSignOut, session }: DesktopShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-950">
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <h1 className="text-xl font-semibold tracking-tight">Flashpart</h1>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex items-center gap-2">
              {navigation.map((item) => (
                <NavLink
                  className={({ isActive }) =>
                    cn(
                      "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100",
                      isActive && "bg-slate-100 text-slate-950",
                    )
                  }
                  key={item.to}
                  to={item.to}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="hidden text-right text-xs text-slate-500 lg:block">
              <div>Signed in</div>
              <div className="font-medium text-slate-700">{session.email}</div>
            </div>
            <Button onClick={onSignOut} type="button" variant="outline">
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <MutationErrorBanner />
      <main className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
