import { REFURBISHED_IMAGE_PROMPT } from "../../convex/listingTypes";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { ShopifyProductTypeSelect } from "../components/shopify-product-type-select";
import { useAction, useMutation } from "convex/react";
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
import { Checkbox } from "../components/ui/checkbox";
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
import {
  DEFAULT_SHOPIFY_SALES_CHANNELS,
  SHOPIFY_SALES_CHANNEL_OPTIONS,
  type ShopifySalesChannelId,
} from "../../convex/shopifyPublishSettings";

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("tab");
  const tab = selected === "parts" || selected === "refurbished" || selected === "gallery" ? selected : "shared";
  return <div className="flex min-h-0 flex-1 flex-col gap-4">
    <nav aria-label="Settings sections" className="flex shrink-0 gap-1 border-b border-slate-200">
      {(["shared", "parts", "refurbished", "gallery"] as const).map(value => <button key={value} type="button" aria-current={tab === value ? "page" : undefined} className={`px-3 py-3 text-sm font-medium capitalize ${tab === value ? "border-b-2 border-slate-950 text-slate-950" : "text-slate-500"}`} onClick={() => setParams({ tab: value })}>{value}</button>)}
    </nav>
    <SettingsPanel key={tab} tab={tab} />
  </div>;
}

function SettingsPanel({ tab }: { tab: "shared" | "parts" | "refurbished" | "gallery"; }) {
  const {
    disconnectShopify,
    setAiImageDefaultPrompt,
    setAiImageEditStrength,
    setAiImageModel,
    setAiImageUpgradeModelOnRegen,
    setAiImageWhitenBackground,
    setAutoArchiveComplete,
    setAutoArchiveCompleteGroups,
    setDuplicatePolicy,
    setMaxProductPhotos,
    setShopifyDefaultTags,
    setShopifyProductType,
    setShopifyPublishTarget,
    setShopifySalesChannels,
    setShopifyShippingPackageId,
    session,
    settings,
    shopifyConnection,
  } = useAppData();
  const loadLocations = useAction(convexApi.shopify.inventoryLocations);
  const loadProductTemplates = useAction(convexApi.shopify.productTemplates);
  const saveLocation = useMutation(convexApi.settings.setShopifyInventoryLocationId);
  const saveProductTemplate = useMutation(
    convexApi.settings.setShopifyProductTemplateSuffix,
  );
  const [locations, setLocations] = React.useState<{ id: string; name: string; }[]>([]);
  const [locationError, setLocationError] = React.useState("");
  const [productTemplates, setProductTemplates] = React.useState<
    { label: string; suffix: string }[]
  >([]);
  const [productTemplateError, setProductTemplateError] = React.useState("");
  React.useEffect(() => {
    if (tab !== "refurbished") return;
    let cancelled = false;
    void loadLocations({ sessionToken: session.sessionToken }).then(values => { if (!cancelled) setLocations(values); }).catch(error => { if (!cancelled) setLocationError(error instanceof Error ? error.message : "Could not load locations."); });
    return () => { cancelled = true; };
  }, [tab, loadLocations, session.sessionToken, shopifyConnection?.updatedAt]);
  React.useEffect(() => {
    if (tab !== "refurbished") return;
    let cancelled = false;
    setProductTemplateError("");
    void loadProductTemplates({ sessionToken: session.sessionToken })
      .then((values) => {
        if (!cancelled) setProductTemplates(values);
      })
      .catch((error) => {
        if (!cancelled) {
          setProductTemplateError(
            error instanceof Error
              ? error.message
              : "Could not load product templates.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    tab,
    loadProductTemplates,
    session.sessionToken,
    shopifyConnection?.updatedAt,
  ]);
  const defaultPrompt = tab === "refurbished" ? REFURBISHED_IMAGE_PROMPT : DEFAULT_AI_IMAGE_PROMPT;
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
  const [shippingPackageId, setShippingPackageId] = React.useState(
    settings?.shopifyShippingPackageId ?? "",
  );
  const [aiImageDefaultPrompt, setAiImageDefaultPromptState] = React.useState(
    settings?.aiImageDefaultPrompt ?? defaultPrompt,
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
  const [maxProductPhotosError, setMaxProductPhotosError] = React.useState<
    string | null
  >(null);
  const [isSavingMaxProductPhotos, setIsSavingMaxProductPhotos] =
    React.useState(false);
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
  const aiImageUpgradeModelOnRegen =
    settings?.aiImageUpgradeModelOnRegen === true;
  const aiImageWhitenBackground =
    settings?.aiImageWhitenBackground !== false;
  const selectedSalesChannels =
    settings?.shopifySalesChannels ?? DEFAULT_SHOPIFY_SALES_CHANNELS;

  React.useEffect(() => {
    setProductType(settings?.shopifyProductType ?? "Part");
  }, [settings?.shopifyProductType]);

  React.useEffect(() => {
    setDefaultTags(settings?.shopifyDefaultTags ?? "");
  }, [settings?.shopifyDefaultTags]);

  React.useEffect(() => {
    setShippingPackageId(settings?.shopifyShippingPackageId ?? "");
  }, [settings?.shopifyShippingPackageId]);

  React.useEffect(() => {
    setAiImageDefaultPromptState(
      settings?.aiImageDefaultPrompt ?? defaultPrompt,
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
    setMaxProductPhotosError(null);
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

  if (!settings) return <p className="text-sm text-slate-500">Loading settings…</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] md:overflow-visible">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Settings
        </h2>
      </div>

      {(tab === "parts" || tab === "refurbished") && (
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
            {tab === "parts" && (
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
            )}
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label className="grid gap-2 text-sm font-medium" htmlFor="product-type">
              Shopify product type
                <ShopifyProductTypeSelect
                  value={productType}
                  onChange={setProductType}
                  onCommit={(value) => {
                    const normalized = value.trim() || "Part";
                    setProductType(normalized);
                    if (normalized !== (settings?.shopifyProductType ?? "Part")) {
                      void setShopifyProductType(normalized).catch(() => undefined);
                    }
                  }}
                />
            </label>
            <p className="text-sm text-slate-500">
                Default type when a listing is uploaded to Shopify. Individual listings
              can override this.
            </p>
          </div>
            {tab === "refurbished" && <label className="grid gap-2 text-sm font-medium">Product template
              <select aria-label="Product template" className="h-10 rounded-md border border-slate-200 bg-white px-3" value={settings?.shopifyProductTemplateSuffix ?? ""} onChange={event => {
                setProductTemplateError("");
                void saveProductTemplate({ sessionToken: session.sessionToken, shopifyProductTemplateSuffix: event.target.value }).catch(error => setProductTemplateError(error instanceof Error ? error.message : "Could not save product template."));
              }}>
                {productTemplates.length === 0 && <option value="">Default product template</option>}
                {productTemplates.map(template => <option value={template.suffix} key={template.suffix}>{template.label}</option>)}
              </select>
              <span className="text-sm font-normal text-slate-500">Applied to every refurbished product created or updated in Shopify.</span>
              {productTemplateError && <span className="text-red-600">{productTemplateError}</span>}
            </label>}
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
              Comma-separated tags merged with each listing&apos;s own tags on upload.
              {tab === "refurbished" && " Single Listing and Refurbished are always added."}
            </p>
          </div>
            {tab === "refurbished" && <label className="grid gap-2 text-sm font-medium">Inventory location
              <select aria-label="Inventory location" className="h-10 rounded-md border border-slate-200 bg-white px-3" value={settings?.shopifyInventoryLocationId ?? ""} onChange={event => {
                setLocationError("");
                void saveLocation({ sessionToken: session.sessionToken, shopifyInventoryLocationId: event.target.value }).catch(error => setLocationError(error instanceof Error ? error.message : "Could not save location."));
              }}><option value="">Select location</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select>
              {locationError && <span className="text-red-600">{locationError}</span>}
            </label>}
        </CardContent>
      </Card>
      )}

      {tab !== "shared" && (
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
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">Upgrade model on regen</p>
              <p className="text-sm text-slate-500">
                When regenerating, use the next better model than the default
                (2.5 → 3.1 Lite → 3.1). New captures still use the selected
                model.
              </p>
            </div>
            <Switch
              aria-label="Upgrade model on regen"
              checked={aiImageUpgradeModelOnRegen}
              onCheckedChange={(checked) =>
                void setAiImageUpgradeModelOnRegen(checked).catch(
                  () => undefined,
                )
              }
            />
          </div>
          <div className="flex items-center justify-between gap-6 rounded-lg border border-slate-200 p-4">
            <div>
              <p className="font-medium">Whiten background</p>
              <p className="text-sm text-slate-500">
                After the first AI generation, pull slightly off-white corners to
                pure white. Regenerations skip this; use Whiten in the photo
                dialog when you need it.
              </p>
            </div>
            <Switch
              aria-label="Whiten background"
              checked={aiImageWhitenBackground}
              onCheckedChange={(checked) =>
                void setAiImageWhitenBackground(checked).catch(() => undefined)
              }
            />
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
                      aiImageDefaultPrompt.trim() || defaultPrompt;

                  if (
                    value !==
                      (settings?.aiImageDefaultPrompt ?? defaultPrompt)
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
            {tab === "parts" && (
          <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="max-product-photos"
            >
              Max photos per product
              <Input
                disabled={isSavingMaxProductPhotos}
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
                  setMaxProductPhotosError(null);

                  if (value === (settings?.maxProductPhotos ?? 5)) {
                    return;
                  }

                  setIsSavingMaxProductPhotos(true);
                  void setMaxProductPhotos(value)
                    .catch((error) => {
                      setMaxProductPhotosError(
                        error instanceof Error
                          ? error.message
                          : "Could not save max photos setting.",
                      );
                      setMaxProductPhotosState(settings?.maxProductPhotos ?? 5);
                    })
                    .finally(() => {
                      setIsSavingMaxProductPhotos(false);
                    });
                }}
                onChange={(event) => {
                  const raw = event.currentTarget.value;
                  if (raw === "") {
                    setMaxProductPhotosState(Number.NaN);
                    return;
                  }

                  const next = Number(raw);
                  if (!Number.isFinite(next)) {
                    return;
                  }

                  setMaxProductPhotosState(
                    Math.min(20, Math.max(1, Math.round(next))),
                  );
                  setMaxProductPhotosError(null);
                }}
                type="number"
                value={Number.isFinite(maxProductPhotos) ? maxProductPhotos : ""}
              />
            </label>
            <p className="text-sm text-slate-500">
              Limits how many original photos can be attached to a single
              product (1–20).
            </p>
            {maxProductPhotosError ? (
              <p className="text-sm text-red-600">{maxProductPhotosError}</p>
            ) : null}
          </div>
            )}
        </CardContent>
      </Card>
      )}

      {tab !== "gallery" && (
      <Card>
          {tab === "shared" && <>
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
          </>}
        <CardContent>
            {tab === "shared" && (
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
                {shopifyConnection && !["read_metaobjects", "read_locations", "write_inventory", "read_themes"].every(scope => shopifyConnection.scopes.includes(scope)) && <p className="text-sm text-amber-700">Reconnect this store to enable refurbished conditions, inventory locations, and product templates.</p>}
          </form>
            )}

            {tab !== "shared" && <>
          <div className="mt-6 grid gap-4 border-t border-slate-200 pt-6">
            <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
              <label
                className="grid gap-2 text-sm font-medium"
                htmlFor="shipping-package-id"
              >
                Default shipping package ID
                <Input
                  id="shipping-package-id"
                  onBlur={() => {
                    if (
                      shippingPackageId !==
                      (settings?.shopifyShippingPackageId ?? "")
                    ) {
                      void setShopifyShippingPackageId(shippingPackageId).catch(
                        () => undefined,
                      );
                    }
                  }}
                  onChange={(event) =>
                    setShippingPackageId(event.currentTarget.value)
                  }
                  placeholder="gid://shopify/CustomShippingPackage/123456789"
                  value={shippingPackageId}
                />
              </label>
              <p className="text-sm text-slate-500">
                Applied to every published variant. Paste the package GID or
                numeric ID from Shopify admin.
              </p>
            </div>

            <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
              <div>
                <p className="text-sm font-medium">Sales channels</p>
                <p className="text-sm text-slate-500">
                  Products are published to the selected channels. Reconnect
                  Shopify if publication scopes are missing.
                </p>
              </div>
              <div className="grid gap-3">
                {SHOPIFY_SALES_CHANNEL_OPTIONS.map((channel) => {
                  const checked = selectedSalesChannels.includes(channel.id);

                  return (
                    <label
                      className="flex items-center gap-3 text-sm"
                      htmlFor={`sales-channel-${channel.id}`}
                      key={channel.id}
                    >
                      <Checkbox
                        checked={checked}
                        id={`sales-channel-${channel.id}`}
                        onCheckedChange={(nextChecked) => {
                          const enabled = nextChecked === true;
                          const next: ShopifySalesChannelId[] = enabled
                            ? selectedSalesChannels.includes(channel.id)
                              ? selectedSalesChannels
                              : [...selectedSalesChannels, channel.id]
                            : selectedSalesChannels.filter(
                                (id) => id !== channel.id,
                              );

                          void setShopifySalesChannels(next).catch(
                            () => undefined,
                          );
                        }}
                      />
                      {channel.label}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

            </>}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
