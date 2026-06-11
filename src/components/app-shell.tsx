import { Boxes, Camera, ListChecks } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "../lib/utils";

const navigation = [
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/groups", label: "Groups", icon: ListChecks },
];

export function AppShell() {
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
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
