import { AlertTriangle, Boxes, Camera, ListChecks, Settings, X } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import type { AuthSession } from "../lib/auth-session";
import { useAppData } from "../data/app-data-provider";

const navigation = [
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/groups", label: "Groups", icon: ListChecks },
  { to: "/settings", label: "Settings", icon: Settings },
];

type AppShellProps = {
  session: AuthSession;
  onSignOut: () => void;
};

export function AppShell({ onSignOut, session }: AppShellProps) {
  const { clearMutationError, lastMutationError } = useAppData();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Camera className="h-6 w-6" />
              <h1 className="text-xl font-semibold tracking-tight">Flashpart</h1>
            </div>
            <p className="text-sm text-slate-500">
              Import parts, group photo work, and queue Shopify draft listings.
            </p>
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
      {lastMutationError ? (
        <div className="border-b border-red-200 bg-red-50">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3 text-sm text-red-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {lastMutationError.label} failed. The UI was reverted.{" "}
                {lastMutationError.message}
              </span>
            </div>
            <Button
              aria-label="Dismiss mutation error"
              onClick={clearMutationError}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
