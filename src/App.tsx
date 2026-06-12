import { ConvexProvider, ConvexReactClient } from "convex/react";
import * as React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthPage } from "./components/auth/auth-page";
import { AppShell, RootRedirect } from "./components/shell/app-shell";
import { AppDataProvider } from "./data/app-data-provider";
import {
  clearStoredSession,
  readStoredSession,
  type AuthSession,
} from "./lib/auth-session";
import { usePreventPinchZoom } from "./lib/use-prevent-pinch-zoom";
import { useIsMobile } from "./lib/use-is-mobile";
import { CapturePage } from "./pages/capture-page";
import { GroupsPage } from "./pages/groups-page";
import { ProductsPage } from "./pages/products-page";
import { SettingsPage } from "./pages/settings-page";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL");
}

const convex = new ConvexReactClient(convexUrl);

export function App() {
  const isMobile = useIsMobile();
  usePreventPinchZoom(isMobile);

  const [session, setSession] = React.useState<AuthSession | null>(
    readStoredSession,
  );

  function handleSignOut() {
    clearStoredSession();
    setSession(null);
  }

  return (
    <ConvexProvider client={convex}>
      {session ? (
        <BrowserRouter>
          <AppDataProvider session={session}>
            <Routes>
              <Route
                element={<AppShell onSignOut={handleSignOut} session={session} />}
              >
                <Route index element={<RootRedirect />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/groups" element={<GroupsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/capture/selection/:selectionId"
                  element={<CapturePage />}
                />
                <Route path="/capture/:groupId" element={<CapturePage />} />
              </Route>
            </Routes>
          </AppDataProvider>
        </BrowserRouter>
      ) : (
        <AuthPage onSignedIn={setSession} />
      )}
    </ConvexProvider>
  );
}
