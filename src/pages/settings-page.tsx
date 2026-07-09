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
import {
  AI_IMAGE_EDIT_STRENGTH_OPTIONS,
  AI_IMAGE_MODEL_OPTIONS,
  DEFAULT_AI_IMAGE_EDIT_STRENGTH,
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROMPT,
  type AiImageEditStrength,
  type AiImageModelId,
} from "../lib/ai-image-settings";
import { convexApi } from "../lib/convex-api";

export function SettingsPage() {
  const {
    disconnectShopify,
    setAiImageDefaultPrompt,
    setAiImageEditStrength,
    setAiImageModel,
    setAutoArchiveComplete,
    setAutoArchiveCompleteGroups,
    setDuplicatePolicy,
    setMaxProductPhotos,
    setShopifyDefaultTags,
    setShopifyProductType,
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
  const [productType, setProductType] = React.useState(
    settings?.shopifyProductType ?? "Part",
  );
  const [defaultTags, setDefaultTags] = React.useState(
    settings?.shopifyDefaultTags ?? "",
  );
  const [aiImageDefaultPrompt, setAiImageDefaultPromptState] = React.useState(
    settings?.aiImageDefaultPrompt ?? DEFAULT_AI_IMAGE_PROMPT,
  );
  const [aiImageModel, setAiImageModelState] = React.useState<AiImageModelId>(
    (settings?.aiImageModel as AiImageModelId | undefined) ??
      DEFAULT_AI_IMAGE_MODEL,
  );
  const [aiImageEditStrength, setAiImageEditStrengthState] =
    React.useState<AiImageEditStrength>(
      (settings?.aiImageEditStrength as AiImageEditStrength | undefined) ??
        DEFAULT_AI_IMAGE_EDIT_STRENGTH,
    );
  const [maxProductPhotos, setMaxProductPhotosState] = React.useState(
    settings?.maxProductPhotos ?? 5,
  );
  const selectedModel = AI_IMAGE_MODEL_OPTIONS.find(
    (option) => option.id === aiImageModel,
  );
  const selectedEditStrength = AI_IMAGE_EDIT_STRENGTH_OPTIONS.find(
    (option) => option.id === aiImageEditStrength,
  );
  const updateExisting = settings?.duplicatePolicy === "updateExisting";
  const publishDirectly = settings?.shopifyPublishTarget === "published";
  const autoArchiveComplete = settings?.autoArchiveComplete === true;
  const autoArchiveCompleteGroups =
    settings?.autoArchiveCompleteGroups === true;

  React.useEffect(() => {
    setProductType(settings?.shopifyProductType ?? "Part");
  }, [settings?.shopifyProductType]);

  React.useEffect(() => {
    setDefaultTags(settings?.shopifyDefaultTags ?? "");
  }, [settings?.shopifyDefaultTags]);

  React.useEffect(() => {
    setAiImageDefaultPromptState(
      settings?.aiImageDefaultPrompt ?? DEFAULT_AI_IMAGE_PROMPT,
    );
  }, [settings?.aiImageDefaultPrompt]);

  React.useEffect(() => {
    setAiImageModelState(
      (settings?.aiImageModel as AiImageModelId | undefined) ??
        DEFAULT_AI_IMAGE_MODEL,
    );
  }, [settings?.aiImageModel]);

  React.useEffect(() => {
    setAiImageEditStrengthState(
      (settings?.aiImageEditStrength as AiImageEditStrength | undefined) ??
        DEFAULT_AI_IMAGE_EDIT_STRENGTH,
    );
  }, [settings?.aiImageEditStrength]);

  React.useEffect(() => {
    setMaxProductPhotosState(settings?.maxProductPhotos ?? 5);
  }, [settings?.maxProductPhotos]);

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
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] md:overflow-visible">
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
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">Auto-archive complete items</p>
              <p className="text-sm text-slate-500">
                Move products to the archive after they are successfully listed
                on Shopify. Errored products stay in the active list.
              </p>
            </div>
            <Switch
              aria-label="Auto-archive complete items"
              checked={autoArchiveComplete}
              onCheckedChange={(checked) =>
                void setAutoArchiveComplete(checked).catch(() => undefined)
              }
            />
          </div>
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">Auto-archive complete groups</p>
              <p className="text-sm text-slate-500">
                Archive a group only after every product in it is archived.
              </p>
            </div>
            <Switch
              aria-label="Auto-archive complete groups"
              checked={autoArchiveCompleteGroups}
              onCheckedChange={(checked) =>
                void setAutoArchiveCompleteGroups(checked).catch(
                  () => undefined,
                )
              }
            />
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label className="grid gap-2 text-sm font-medium" htmlFor="product-type">
              Shopify product type
              <Input
                id="product-type"
                onBlur={() => {
                  const value = productType.trim() || "Part";

                  if (value !== (settings?.shopifyProductType ?? "Part")) {
                    void setShopifyProductType(value).catch(() => undefined);
                  }
                }}
                onChange={(event) => setProductType(event.currentTarget.value)}
                placeholder="Part"
                value={productType}
              />
            </label>
            <p className="text-sm text-slate-500">
              Applied to every part when it is uploaded to Shopify.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label className="grid gap-2 text-sm font-medium" htmlFor="default-tags">
              Default Shopify tags
              <Input
                id="default-tags"
                onBlur={() => {
                  if (defaultTags !== (settings?.shopifyDefaultTags ?? "")) {
                    void setShopifyDefaultTags(defaultTags).catch(() => undefined);
                  }
                }}
                onChange={(event) => setDefaultTags(event.currentTarget.value)}
                placeholder="parts, inventory"
                value={defaultTags}
              />
            </label>
            <p className="text-sm text-slate-500">
              Comma-separated tags merged with each part&apos;s own tags on upload.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI photo editing</CardTitle>
          <CardDescription>
            Default prompt, model, and edit strength used when product photos are
            enhanced after capture. Gemini does not expose a reference-image
            weight slider, so edit strength adjusts prompt framing and model
            temperature instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label className="grid gap-2 text-sm font-medium" htmlFor="ai-image-model">
              Gemini model
              <select
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none ring-slate-950/10 focus:ring-2"
                id="ai-image-model"
                onChange={(event) => {
                  const value = event.currentTarget.value as AiImageModelId;

                  setAiImageModelState(value);
                  void setAiImageModel(value).catch(() => undefined);
                }}
                value={aiImageModel}
              >
                {AI_IMAGE_MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-slate-500">
              {selectedModel?.description ??
                "Applies to new captures and regenerations."}
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="ai-image-edit-strength"
            >
              Edit strength
              <select
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none ring-slate-950/10 focus:ring-2"
                id="ai-image-edit-strength"
                onChange={(event) => {
                  const value = event.currentTarget.value as AiImageEditStrength;

                  setAiImageEditStrengthState(value);
                  void setAiImageEditStrength(value).catch(() => undefined);
                }}
                value={aiImageEditStrength}
              >
                {AI_IMAGE_EDIT_STRENGTH_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-slate-500">
              {selectedEditStrength?.description ??
                "Controls how much the AI changes the original capture."}
              {" "}Try Strong if results look too similar to the original photo.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="ai-image-default-prompt"
            >
              Default AI prompt
              <textarea
                className="min-h-28 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-slate-950/10 focus:ring-2"
                id="ai-image-default-prompt"
                onBlur={() => {
                  const value =
                    aiImageDefaultPrompt.trim() || DEFAULT_AI_IMAGE_PROMPT;

                  if (
                    value !==
                    (settings?.aiImageDefaultPrompt ?? DEFAULT_AI_IMAGE_PROMPT)
                  ) {
                    void setAiImageDefaultPrompt(value).catch(() => undefined);
                  }
                }}
                onChange={(event) =>
                  setAiImageDefaultPromptState(event.currentTarget.value)
                }
                value={aiImageDefaultPrompt}
              />
            </label>
            <p className="text-sm text-slate-500">
              Used for new captures and retakes. Per-product prompt edits in the
              photo dialog are kept until the photo is retaken.
            </p>
          </div>
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="max-product-photos"
            >
              Max photos per product
              <Input
                id="max-product-photos"
                inputMode="numeric"
                max={20}
                min={1}
                onBlur={() => {
                  const parsed = Number(maxProductPhotos);
                  const value = Number.isFinite(parsed)
                    ? Math.min(20, Math.max(1, Math.round(parsed)))
                    : 5;

                  setMaxProductPhotosState(value);

                  if (value !== (settings?.maxProductPhotos ?? 5)) {
                    void setMaxProductPhotos(value).catch(() => undefined);
                  }
                }}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  setMaxProductPhotosState(
                    Number.isFinite(next) ? next : (settings?.maxProductPhotos ?? 5),
                  );
                }}
                type="number"
                value={maxProductPhotos}
              />
            </label>
            <p className="text-sm text-slate-500">
              Limits how many original photos can be attached to a single
              product (1–20).
            </p>
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
