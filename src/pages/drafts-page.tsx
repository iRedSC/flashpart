import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { Camera, Check, ExternalLink, Eye, Loader2, RefreshCw, Send } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ProductPhotoDialog } from "../components/product-photo-dialog";
import { ProductThumbnail } from "../components/product-thumbnail";
import { Button } from "../components/ui/button";
import { useAppData } from "../data/app-data-provider";
import { convexApi } from "../lib/convex-api";
import { triggerHaptic } from "../lib/haptics";
import {
  canPublishProduct,
  listAis,
  listOriginals,
  needsAiPhotoApproval,
  type ProductPhoto,
} from "../lib/product-photo";
import { persistedProductIds } from "../lib/product-id";
import { shopifyAdminProductUrl } from "../lib/shopify-admin";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];

/** One next action per draft; the row renders exactly this. */
type DraftStep =
  | "loading"
  | "photograph"
  | "processing"
  | "review"
  | "ready"
  | "publishing"
  | "published";

function draftStep(product: Product, photos: ProductPhoto[] | undefined): DraftStep {
  if (product.pendingOperation === "publishing") return "publishing";
  if (product.phase === "published") return "published";
  if (photos === undefined) return "loading";
  if (listOriginals(photos).length === 0) return "photograph";
  if (canPublishProduct({ ...product, pendingOperation: product.pendingOperation ?? undefined }, photos)) return "ready";
  const ais = listAis(photos);
  if (ais.some((photo) => needsAiPhotoApproval(photo) || photo.aiStatus === "failed")) return "review";
  return "processing";
}

type SyncState = { status: "idle" | "syncing" } | { status: "failed"; message: string };

export function DraftsPage() {
  const { products, publishProducts, session, shopifyConnection, isLoading } = useAppData();
  const navigate = useNavigate();
  const syncDrafts = useAction(convexApi.shopifyDrafts.sync);
  const [sync, setSync] = React.useState<SyncState>({ status: "idle" });
  const [photoProductId, setPhotoProductId] = React.useState<Id<"products"> | null>(null);
  // Published drafts stay visible for the visit they were published in, so the
  // result is seen before the row leaves the list.
  const [seenUnpublished] = React.useState(() => new Set<string>());
  const shopDomain = shopifyConnection?.shopDomain;

  const drafts = React.useMemo(
    () =>
      products
        .filter((product) => product.listingKind === "shopifyDraft" && product.shopifyDraftShop === shopDomain && product.archivedAt === undefined)
        .filter((product) => {
          if (product.phase !== "published") seenUnpublished.add(product._id);
          return seenUnpublished.has(product._id);
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    [products, seenUnpublished, shopDomain],
  );
  const draftIds = React.useMemo(() => persistedProductIds(drafts), [drafts]);
  const photosQuery = useQuery(
    convexApi.productPhotos.listForProducts,
    draftIds.length > 0 ? { productIds: draftIds, sessionToken: session.sessionToken } : "skip",
  );
  const photosByProductId = photosQuery as Record<string, ProductPhoto[]> | undefined;
  const steps = new Map(drafts.map((draft) => [draft._id, draftStep(draft, photosByProductId?.[draft._id] ?? (photosQuery ? [] : undefined))]));
  const readyIds = drafts.filter((draft) => steps.get(draft._id) === "ready").map((draft) => draft._id);
  const photoProduct = drafts.find((draft) => draft._id === photoProductId) ?? null;

  const runSync = React.useCallback(() => {
    setSync({ status: "syncing" });
    syncDrafts({ sessionToken: session.sessionToken })
      .then(() => setSync({ status: "idle" }))
      .catch((error: unknown) =>
        setSync({ status: "failed", message: error instanceof Error ? error.message : "Could not load drafts." }),
      );
  }, [session.sessionToken, syncDrafts]);

  const connected = Boolean(shopifyConnection);
  React.useEffect(() => {
    if (connected) runSync();
  }, [connected, runSync]);

  function publish(ids: Id<"products">[]) {
    triggerHaptic();
    void publishProducts(ids);
  }

  if (!isLoading && !connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-sm text-slate-500">Connect Shopify to load drafts.</p>
        <Button asChild variant="outline">
          <Link to="/settings">Open settings</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pb-4 md:overflow-visible">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Drafts</h2>
        <div className="flex items-center gap-2">
          {readyIds.length > 0 ? (
            <Button onClick={() => publish(readyIds)}>
              <Send className="h-4 w-4" />
              Publish {readyIds.length}
            </Button>
          ) : null}
          <Button
            aria-label="Refresh drafts"
            disabled={sync.status === "syncing"}
            onClick={runSync}
            size="icon"
            variant="outline"
          >
            <RefreshCw className={cn("h-4 w-4", sync.status === "syncing" && "animate-spin")} />
          </Button>
        </div>
      </div>

      {sync.status === "failed" ? <p className="text-sm font-medium text-red-600">{sync.message}</p> : null}

      {drafts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-sm text-slate-500">
          {sync.status === "syncing" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Check className="h-8 w-8 text-slate-950" />}
          {sync.status === "syncing" ? null : "Every draft has photos."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <DraftRow
              key={draft._id}
              onOpenPhotos={() => setPhotoProductId(draft._id)}
              onPublish={() => publish([draft._id])}
              onTakePhotos={() => navigate(`/capture/product/${draft._id}`)}
              photos={photosByProductId?.[draft._id] ?? (photosQuery ? [] : undefined)}
              product={draft}
              shopDomain={shopifyConnection?.shopDomain}
              step={steps.get(draft._id) ?? "loading"}
            />
          ))}
        </ul>
      )}

      <ProductPhotoDialog
        onClose={() => setPhotoProductId(null)}
        onOpenProduct={setPhotoProductId}
        photosByProductId={photosByProductId}
        product={photoProduct}
      />
    </div>
  );
}

function DraftRow({
  onOpenPhotos,
  onPublish,
  onTakePhotos,
  photos,
  product,
  shopDomain,
  step,
}: {
  onOpenPhotos: () => void;
  onPublish: () => void;
  onTakePhotos: () => void;
  photos: ProductPhoto[] | undefined;
  product: Product;
  shopDomain?: string;
  step: DraftStep;
}) {
  const photoCount = photos ? listOriginals(photos).length : undefined;
  const adminUrl = shopifyAdminProductUrl(shopDomain, product.shopifyProductId ?? product.shopifyDraftId);
  const error = step === "ready" ? product.lastError?.message : undefined;

  return (
    <li
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors md:items-center",
        step === "published" && "border-green-200 bg-green-50",
        error && "border-red-200",
      )}
    >
      <ProductThumbnail
        className="size-16 shrink-0"
        onClick={photoCount ? onOpenPhotos : onTakePhotos}
        photoCount={photoCount}
        photos={photos}
        product={product}
      />
      {/* Stacked on mobile so the name keeps the full width; inline on desktop. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium" title={product.name}>{product.name}</p>
          <p className="truncate text-xs text-slate-500">
            <span className="font-mono">{product.sku || "No SKU"}</span> · ${product.price.toFixed(2)}
          </p>
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-row-reverse items-center justify-between gap-1 md:flex-row">
          {adminUrl ? (
            <Button asChild aria-label="Open in Shopify" size="icon" variant="ghost">
              <a href={adminUrl} rel="noreferrer" target="_blank"><ExternalLink className="h-4 w-4" /></a>
            </Button>
          ) : null}
          <DraftAction onOpenPhotos={onOpenPhotos} onPublish={onPublish} onTakePhotos={onTakePhotos} step={step} />
        </div>
      </div>
    </li>
  );
}

function DraftAction({
  onOpenPhotos,
  onPublish,
  onTakePhotos,
  step,
}: {
  onOpenPhotos: () => void;
  onPublish: () => void;
  onTakePhotos: () => void;
  step: DraftStep;
}) {
  switch (step) {
    case "loading":
      return null;
    case "photograph":
      return <Button onClick={onTakePhotos} variant="outline"><Camera className="h-4 w-4" />Photos</Button>;
    case "processing":
      return <Button onClick={onOpenPhotos} variant="ghost"><Loader2 className="h-4 w-4 animate-spin" />Editing</Button>;
    case "review":
      return <Button onClick={onOpenPhotos} variant="outline"><Eye className="h-4 w-4" />Review</Button>;
    case "ready":
      return <Button onClick={onPublish}><Send className="h-4 w-4" />Publish</Button>;
    case "publishing":
      return <Button disabled variant="ghost"><Loader2 className="h-4 w-4 animate-spin" />Publishing</Button>;
    case "published":
      return <span className="flex items-center gap-1 px-2 text-sm font-medium text-green-700"><Check className="h-4 w-4" />Published</span>;
  }
}
