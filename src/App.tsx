import { ConvexProvider, ConvexReactClient } from "convex/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/app-shell";
import { AppDataProvider } from "./data/app-data-provider";
import { CapturePage } from "./pages/capture-page";
import { GroupsPage } from "./pages/groups-page";
import { ProductsPage } from "./pages/products-page";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL");
}

const convex = new ConvexReactClient(convexUrl);

export function App() {
  return (
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <AppDataProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate replace to="/products" />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/capture/:groupId" element={<CapturePage />} />
            </Route>
          </Routes>
        </AppDataProvider>
      </BrowserRouter>
    </ConvexProvider>
  );
}
