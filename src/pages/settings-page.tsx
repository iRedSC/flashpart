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
    setShopifyPublishTarget,
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
  const publishDirectly = settings?.shopifyPublishTarget === "published";

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
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain md:overflow-visible">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Settings
        </h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listing defaults</CardTitle>
          <CardDescription>
            Default behavior for imports and Shopify publish actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">
                Update existing Shopify products when SKU matches
              </p>
              <p className="text-sm text-slate-500">
                Replaces the matching Shopify listing with the imported product
                data.
              </p>
            </div>
            <Switch
              aria-label="Update existing Shopify products when SKU matches"
              checked={updateExisting}
              onCheckedChange={(checked) =>
                void setDuplicatePolicy(
                  checked ? "updateExisting" : "blockExisting",
                ).catch(() => undefined)
              }
            />
          </div>
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">Publish products live to Shopify</p>
              <p className="text-sm text-slate-500">
                Listings go directly to your storefront as published products.
              </p>
            </div>
            <Switch
              aria-label="Publish products live to Shopify"
              checked={publishDirectly}
              onCheckedChange={(checked) =>
                void setShopifyPublishTarget(
                  checked ? "published" : "draft",
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
                Draft listings are created in this store.
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
              You'll be redirected to Shopify to authorize the app.
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
