import { ConvexProvider, ConvexReactClient, useAction } from "convex/react";
import * as React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthPage } from "./components/auth/auth-page";
import { AppShell, RootRedirect } from "./components/shell/app-shell";
import { AppDataProvider } from "./data/app-data-provider";
import {
  clearStoredSession,
  readStoredSession,
  storeSession,
  type AuthSession,
} from "./lib/auth-session";
import { convexApi } from "./lib/convex-api";
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

const isPreviewEnv = import.meta.env.ENV === "PREVIEW";

export function App() {
  const isMobile = useIsMobile();
  usePreventPinchZoom(isMobile);

  return (
    <ConvexProvider client={convex}>
      <AuthenticatedApp />
    </ConvexProvider>
  );
}

function AuthenticatedApp() {
  const previewAutologin = useAction(
    convexApi.auth.createPreviewAutologinSession,
  );
  const [session, setSession] = React.useState<AuthSession | null>(
    readStoredSession,
  );
  const [previewBooting, setPreviewBooting] = React.useState(
    () => !readStoredSession() && isPreviewEnv,
  );

  React.useEffect(() => {
    if (!previewBooting) {
      return;
    }

    void previewAutologin({})
      .then((result) => {
        const authSession = {
          email: result.email,
          sessionToken: result.sessionToken,
        };
        storeSession(authSession);
        setSession(authSession);
      })
      .catch(() => {})
      .finally(() => setPreviewBooting(false));
  }, [previewAutologin, previewBooting]);

  function handleSignOut() {
    clearStoredSession();
    setSession(null);
  }

  if (previewBooting) {
    return null;
  }

  return session ? (
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
  );
}
