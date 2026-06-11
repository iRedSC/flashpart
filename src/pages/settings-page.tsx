import * as React from "react";
import { useAction } from "convex/react";
import { Link2Off, Store } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { useAppData } from "../data/app-data-provider";
import { convexApi } from "../lib/convex-api";

export function SettingsPage() {
  const {
    disconnectShopify,
    setDuplicatePolicy,
    session,
    settings,
    shopifyConnection,
  } = useAppData();
  const startShopifyInstall = useAction(convexApi.shopify.startShopifyInstall);
  const [shopDomain, setShopDomain] = React.useState(
    shopifyConnection?.shopDomain ?? "",
  );
  const [message, setMessage] = React.useState("");
  const [isConnecting, setIsConnecting] = React.useState(false);
  const updateExisting = settings?.duplicatePolicy === "updateExisting";

  React.useEffect(() => {
    setShopDomain(shopifyConnection?.shopDomain ?? "");
  }, [shopifyConnection?.shopDomain]);

  async function handleShopifySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!shopDomain.trim()) {
      return;
    }

    try {
      const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL;

      if (!convexSiteUrl) {
        throw new Error("Missing VITE_CONVEX_SITE_URL in environment.");
      }

      setIsConnecting(true);

      const redirectUri = `${convexSiteUrl.replace(/\/$/, "")}/shopify/callback`;
      const { authUrl } = await startShopifyInstall({
        redirectUri,
        sessionToken: session.sessionToken,
        shopDomain: shopDomain.trim(),
      });

      window.location.href = authUrl;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not start Shopify setup.",
      );
      setIsConnecting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">Settings</h2>
        <p className="text-slate-500">
          Store-wide MVP controls for duplicate SKUs and Shopify connection state.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Existing SKU behavior</CardTitle>
          <CardDescription>
            This applies globally to imported products instead of living in the table.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">
                {updateExisting ? "Update existing Shopify products" : "Block existing Shopify SKUs"}
              </p>
              <p className="text-sm text-slate-500">
                {updateExisting
                  ? "If a SKU already exists, the listing job may update its draft data."
                  : "If a SKU already exists, the row should be blocked before Shopify writes."}
              </p>
            </div>
            <Switch
              aria-label="Toggle existing SKU behavior"
              checked={updateExisting}
              onCheckedChange={(checked) =>
                void setDuplicatePolicy(
                  checked ? "updateExisting" : "blockExisting",
                ).catch(() => undefined)
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Shopify store</CardTitle>
              <CardDescription>
                Link the internal Shopify store that receives draft product listings.
              </CardDescription>
            </div>
            <Badge variant={shopifyConnection?.isActive ? "default" : "secondary"}>
              {shopifyConnection?.isActive ? "connected" : "disconnected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid max-w-2xl gap-4" onSubmit={handleShopifySubmit}>
            <label className="grid gap-2 text-sm font-medium">
              Shop domain
              <Input
                onChange={(event) => setShopDomain(event.currentTarget.value)}
                placeholder="your-store.myshopify.com"
                value={shopDomain}
              />
            </label>
            <p className="text-sm text-slate-500">
              You will be redirected to Shopify to authorize the app. Convex
              verifies the callback and stores the access token server-side.
            </p>
            {shopifyConnection ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <p className="font-medium">{shopifyConnection.shopDomain}</p>
                <p className="text-slate-500">
                  Scopes: {shopifyConnection.scopes.join(", ")}
                </p>
              </div>
            ) : null}
            {message ? <p className="text-sm text-red-600">{message}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={isConnecting} type="submit">
                <Store className="h-4 w-4" />
                {isConnecting ? "Connecting..." : "Continue to Shopify"}
              </Button>
              <Button
                onClick={() => void disconnectShopify().catch(() => undefined)}
                disabled={!shopifyConnection}
                type="button"
                variant="outline"
              >
                <Link2Off className="h-4 w-4" />
                Disconnect
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
