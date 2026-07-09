import * as React from "react";
import { useConvex, useQuery } from "convex/react";
import {
  AlertCircle,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PencilLine,
  RefreshCcw,
  Replace,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useAppData } from "../data/app-data-provider";
import { cropImageFileToSquare } from "../lib/capture-image";
import { convexApi } from "../lib/convex-api";
import { triggerHaptic } from "../lib/haptics";
import { DEFAULT_AI_IMAGE_PROMPT } from "../lib/ai-image-settings";
import {
  buildPhotoPairs,
  findNextPhotoNeedingApproval,
  isAiImageFailed,
  isAiImageGenerating,
  needsAiPhotoApproval,
  needsPhotoApproval,
  type ProductPhoto,
  type ProductPhotoPair,
} from "../lib/product-photo";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];
type PhotoView = "original" | "ai";
type CaptureMode = "add" | "replace";

type DialogPair = {
  original: ProductPhoto | null;
  ai: ProductPhoto | null;
  sortOrder: number;
  isLegacy: boolean;
};

function toClientPhoto(photo: {
  _id: Id<"productPhotos">;
  productId: Id<"products">;
  kind: "original" | "ai";
  storageId?: Id<"_storage">;
  url?: string;
  shopifyFileId?: string;
  shopifyFileStatus?: string;
  status: ProductPhoto["status"];
  sortOrder: number;
  sourcePhotoId?: Id<"productPhotos">;
  approvedAt?: number;
  aiStatus?: ProductPhoto["aiStatus"];
  aiPrompt?: string;
  aiError?: string;
  captureId?: Id<"captures">;
  createdAt: number;
  updatedAt: number;
}): ProductPhoto {
  return {
    _id: photo._id,
    productId: photo.productId,
    kind: photo.kind,
    storageId: photo.storageId,
    url: photo.url,
    shopifyFileId: photo.shopifyFileId,
    shopifyFileStatus: photo.shopifyFileStatus,
    status: photo.status,
    sortOrder: photo.sortOrder,
    sourcePhotoId: photo.sourcePhotoId,
    approvedAt: photo.approvedAt,
    aiStatus: photo.aiStatus,
    aiPrompt: photo.aiPrompt,
    aiError: photo.aiError,
    captureId: photo.captureId,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
  };
}

function buildDialogPairs(
  photos: ProductPhoto[] | undefined,
  product: Product | null,
): DialogPair[] {
  // U2: while loading, do not flash legacy Shopify pairs.
  if (photos === undefined) {
    return [];
  }

  if (photos.length > 0) {
    return buildPhotoPairs(photos).map((pair: ProductPhotoPair) => ({
      original: pair.original,
      ai: pair.ai,
      sortOrder: pair.sortOrder,
      isLegacy: false,
    }));
  }

  if (
    product &&
    (product.shopifyFileUrl ||
      product.aiShopifyFileUrl ||
      isAiImageGenerating(product) ||
      isAiImageFailed(product))
  ) {
    const now = product.updatedAt ?? product.createdAt;
    const original: ProductPhoto | null = product.shopifyFileUrl
      ? {
          _id: `legacy-original:${product._id}`,
          productId: product._id,
          kind: "original",
          url: product.shopifyFileUrl,
          status: "ready",
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        }
      : null;
    const ai: ProductPhoto | null =
      product.aiShopifyFileUrl ||
      product.aiImageStatus === "generating" ||
      product.aiImageStatus === "failed" ||
      product.aiImageStatus === "pending" ||
      product.aiImageStatus === "ready"
        ? {
            _id: `legacy-ai:${product._id}`,
            productId: product._id,
            kind: "ai",
            url: product.aiShopifyFileUrl,
            status:
              product.aiImageStatus === "ready"
                ? "ready"
                : product.aiImageStatus === "failed"
                  ? "failed"
                  : "uploading",
            sortOrder: 0,
            approvedAt: product.needsPhotoReview ? undefined : now,
            aiStatus: product.aiImageStatus,
            aiPrompt: product.aiImagePrompt,
            aiError: product.aiImageError,
            createdAt: now,
            updatedAt: now,
          }
        : null;

    return [
      {
        original,
        ai,
        sortOrder: 0,
        isLegacy: true,
      },
    ];
  }

  return [];
}

function pairAiGenerating(pair: DialogPair, product: Product | null) {
  if (
    pair.ai?.aiStatus === "generating" ||
    pair.ai?.status === "uploading" ||
    pair.ai?.aiStatus === "pending"
  ) {
    return true;
  }

  // Product-level pendingOperation only for legacy single-photo pairs —
  // otherwise it marks every pair as generating.
  if (pair.isLegacy && product) {
    return isAiImageGenerating(product);
  }

  return false;
}

function pairAiFailed(pair: DialogPair, product: Product | null) {
  if (pair.ai?.aiStatus === "failed") {
    return true;
  }

  if (pair.isLegacy && product) {
    return isAiImageFailed(product);
  }

  return false;
}

export function ProductPhotoDialog({
  onClose,
  onOpenProduct,
  photosByProductId,
  product,
}: {
  onClose: () => void;
  onOpenProduct: (productId: Id<"products">) => void;
  photosByProductId?: Record<string, ProductPhoto[]>;
  product: Product | null;
}) {
  const {
    addProductPhoto,
    approveAiPhoto,
    approvePhoto,
    deleteProductPhoto,
    products,
    regenerateAiImage,
    regenerateAiImageForPhoto,
    replaceProductPhoto,
    session,
    settings,
  } = useAppData();
  const convex = useConvex();
  const defaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;
  const maxProductPhotos = settings?.maxProductPhotos ?? 5;
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const touchStartXRef = React.useRef<number | null>(null);
  const initializedForProductRef = React.useRef<string | null>(null);
  /** After add, focus the new pair once listByProduct includes this original. */
  const pendingFocusOriginalIdRef = React.useRef<string | null>(null);
  const [captureFile, setCaptureFile] = React.useState<File | null>(null);
  const [captureMode, setCaptureMode] = React.useState<CaptureMode>("add");
  const [activeView, setActiveView] = React.useState<PhotoView>("ai");
  const [pairIndex, setPairIndex] = React.useState(0);
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [draftPrompt, setDraftPrompt] = React.useState(defaultPrompt);
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [isApproving, setIsApproving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<string | null>(null);
  const previewUrl = React.useMemo(
    () => (captureFile ? URL.createObjectURL(captureFile) : null),
    [captureFile],
  );

  const productPhotos = useQuery(
    convexApi.productPhotos.listByProduct,
    product
      ? { productId: product._id, sessionToken: session.sessionToken }
      : "skip",
  );
  const photosLoading = product !== null && productPhotos === undefined;

  const photos = React.useMemo(
    () =>
      productPhotos === undefined
        ? undefined
        : productPhotos.map(toClientPhoto),
    [productPhotos],
  );

  const pairs = React.useMemo(
    () => buildDialogPairs(photos, product),
    [photos, product],
  );

  const safePairIndex =
    pairs.length === 0 ? 0 : Math.min(pairIndex, pairs.length - 1);
  const currentPair = pairs[safePairIndex] ?? null;

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  React.useEffect(() => {
    if (!product) {
      initializedForProductRef.current = null;
      pendingFocusOriginalIdRef.current = null;
      return;
    }

    const nextPrompt = product.aiImagePrompt ?? defaultPrompt;
    setPrompt(nextPrompt);
    setDraftPrompt(nextPrompt);
    setPairIndex(0);
    setError(null);
    setStage(null);
    setCaptureFile(null);
    setCaptureMode("add");
    setPromptDialogOpen(false);
    initializedForProductRef.current = null;
    pendingFocusOriginalIdRef.current = null;

    const preferOriginal =
      isAiImageGenerating(product) || isAiImageFailed(product);
    setActiveView(preferOriginal ? "original" : "ai");
  }, [defaultPrompt, product?._id]);

  React.useEffect(() => {
    if (!product || productPhotos === undefined) {
      return;
    }

    // Wait until pairs exist so empty→loaded and legacy→multi can re-init.
    if (pairs.length === 0) {
      return;
    }

    const pendingOriginalId = pendingFocusOriginalIdRef.current;
    if (pendingOriginalId) {
      const focusIndex = pairs.findIndex(
        (pair) => pair.original?._id === pendingOriginalId,
      );
      if (focusIndex >= 0) {
        pendingFocusOriginalIdRef.current = null;
        setPairIndex(focusIndex);
        initializedForProductRef.current = `${product._id}:${
          pairs.some((pair) => pair.isLegacy) ? "legacy" : "photos"
        }`;
        return;
      }
    }

    const mode = pairs.some((pair) => pair.isLegacy) ? "legacy" : "photos";
    const initKey = `${product._id}:${mode}`;

    if (initializedForProductRef.current === initKey) {
      return;
    }

    const previousKey = initializedForProductRef.current;
    initializedForProductRef.current = initKey;

    // Real Convex photos replacing a synthetic legacy pair — reset carousel.
    if (
      previousKey === `${product._id}:legacy` &&
      mode === "photos"
    ) {
      setPairIndex(0);
    }

    const firstNeedingApproval = pairs.findIndex(
      (pair) => pair.ai != null && needsAiPhotoApproval(pair.ai),
    );

    if (firstNeedingApproval >= 0) {
      setPairIndex(firstNeedingApproval);
      setActiveView("ai");
    }
  }, [product?._id, productPhotos, pairs]);

  React.useEffect(() => {
    if (pendingFocusOriginalIdRef.current) {
      return;
    }
    if (pairIndex >= pairs.length && pairs.length > 0) {
      setPairIndex(pairs.length - 1);
    }
  }, [pairIndex, pairs.length]);

  const originalUrl =
    previewUrl ??
    currentPair?.original?.url ??
    (currentPair?.isLegacy ? (product?.shopifyFileUrl ?? null) : null);
  const aiUrl =
    currentPair?.ai?.url ??
    (currentPair?.isLegacy ? (product?.aiShopifyFileUrl ?? null) : null);
  const aiGenerating = currentPair
    ? pairAiGenerating(currentPair, product)
    : false;
  const aiFailed = currentPair ? pairAiFailed(currentPair, product) : false;
  // Missing AI (not generating / failed) — show Regen, not an eternal spinner.
  const aiAbsent = Boolean(
    currentPair &&
      activeView === "ai" &&
      !aiUrl &&
      !aiGenerating &&
      !aiFailed,
  );
  const canTakePhoto = Boolean(product?.groupId);
  const isBusy = isSaving || isRegenerating || isApproving || isDeleting;
  const originalCount = pairs.filter((pair) => pair.original != null).length;
  // U3: once photos loaded, enforce max (no legacy exemption).
  const canAddPhoto =
    canTakePhoto && !photosLoading && originalCount < maxProductPhotos;
  const canReplacePhoto = Boolean(
    canTakePhoto &&
      currentPair?.original &&
      !currentPair.isLegacy &&
      !photosLoading,
  );
  const hasPhotoTabs = Boolean(
    pairs.length > 0 ||
      originalUrl ||
      aiUrl ||
      aiGenerating ||
      aiFailed ||
      captureFile,
  );
  const canNavigatePairs = pairs.length > 1 && !captureFile;
  const displayUrl = activeView === "ai" ? aiUrl : originalUrl;
  const currentAiNeedsApproval =
    currentPair?.ai != null
      ? needsAiPhotoApproval(currentPair.ai)
      : Boolean(product && currentPair?.isLegacy && needsPhotoApproval(product));
  const pairPositionLabel =
    pairs.length > 0 ? `${safePairIndex + 1}/${pairs.length}` : null;
  const showExistingOriginalActions =
    activeView === "original" &&
    !captureFile &&
    Boolean(currentPair?.original) &&
    !currentPair?.isLegacy;
  const canSaveCapture =
    Boolean(captureFile) &&
    !isBusy &&
    (captureMode === "replace" ? canReplacePhoto : canAddPhoto);

  function resetCapture() {
    setCaptureFile(null);
    setCaptureMode("add");
    setError(null);
    setStage(null);
  }

  function handleClose() {
    if (isBusy) {
      return;
    }

    resetCapture();
    setPromptDialogOpen(false);
    onClose();
  }

  function switchView(view: PhotoView) {
    setActiveView(view);
    setError(null);
  }

  function goToPair(nextIndex: number) {
    if (pairs.length === 0) {
      return;
    }

    const clamped = Math.max(0, Math.min(nextIndex, pairs.length - 1));

    if (clamped === safePairIndex) {
      return;
    }

    setPairIndex(clamped);
    setError(null);
    triggerHaptic();
  }

  function openPromptDialog() {
    const pairPrompt = currentPair?.ai?.aiPrompt?.trim();
    setDraftPrompt(pairPrompt || prompt);
    setPromptDialogOpen(true);
  }

  function savePrompt() {
    const trimmed = draftPrompt.trim();

    if (!trimmed) {
      setError("Enter a prompt before saving.");
      return;
    }

    setPrompt(trimmed);
    setError(null);
    setPromptDialogOpen(false);
    triggerHaptic();
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current;

    if (startX === null || captureFile || pairs.length <= 1) {
      return;
    }

    const endX = event.changedTouches[0]?.clientX ?? startX;
    const deltaX = endX - startX;

    if (Math.abs(deltaX) < 48) {
      return;
    }

    if (deltaX < 0) {
      goToPair(safePairIndex + 1);
    } else {
      goToPair(safePairIndex - 1);
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;

    event.currentTarget.value = "";
    setError(null);

    if (!file) {
      return;
    }

    try {
      setCaptureFile(await cropImageFileToSquare(file));
      setActiveView("original");
      triggerHaptic();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Photo could not be processed. Please try again.",
      );
    }
  }

  function handleTakePhoto(mode: CaptureMode = "add") {
    if (mode === "add" && !canAddPhoto) {
      return;
    }

    if (mode === "replace" && !canReplacePhoto) {
      return;
    }

    setCaptureMode(mode);
    fileInputRef.current?.click();
  }

  async function handleSave() {
    if (!product?.groupId || !captureFile || isBusy) {
      return;
    }

    if (captureMode === "add" && !canAddPhoto) {
      return;
    }

    if (captureMode === "replace") {
      if (!currentPair?.original || currentPair.isLegacy) {
        return;
      }
    }

    triggerHaptic();
    setError(null);
    setIsSaving(true);

    try {
      setStage(
        captureMode === "replace"
          ? "Replacing photo..."
          : "Uploading photo...",
      );

      if (captureMode === "replace" && currentPair?.original) {
        await replaceProductPhoto({
          file: captureFile,
          groupId: product.groupId,
          photoId: currentPair.original._id as Id<"productPhotos">,
          productId: product._id,
        });
      } else {
        const { photoId } = await addProductPhoto({
          groupId: product.groupId,
          productId: product._id,
          file: captureFile,
        });
        // Focus the new pair only after listByProduct includes this original.
        pendingFocusOriginalIdRef.current = photoId;
      }

      triggerHaptic();
      resetCapture();
      setPrompt(defaultPrompt);
      setDraftPrompt(defaultPrompt);
      setActiveView("ai");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Photo upload failed. Check your connection and retry.",
      );
    } finally {
      setIsSaving(false);
      setStage(null);
    }
  }

  async function handleRegenerate() {
    if (!product || isBusy || aiGenerating) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsRegenerating(true);
    setActiveView("ai");

    try {
      if (currentPair && !currentPair.isLegacy && currentPair.original) {
        await regenerateAiImageForPhoto({
          originalPhotoId: currentPair.original._id as Id<"productPhotos">,
          prompt,
        });
      } else {
        await regenerateAiImage({
          productId: product._id,
          prompt,
        });
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "AI photo regeneration failed. Please try again.",
      );
    } finally {
      setIsRegenerating(false);
    }
  }

  async function resolveNextProductNeedingApproval(
    currentProductId: Id<"products">,
  ): Promise<Id<"products"> | null> {
    // Prefer a fresh batch so approve→next does not miss siblings still
    // needing review while the parent photosByProductId map is stale.
    try {
      const productIds = products.map(
        (entry) => entry._id as Id<"products">,
      );
      if (productIds.length > 0) {
        const freshByProductId = await convex.query(
          convexApi.productPhotos.listForProducts,
          {
            productIds,
            sessionToken: session.sessionToken,
          },
        );
        const freshMap: Record<string, ProductPhoto[]> = {};
        for (const [id, photos] of Object.entries(freshByProductId)) {
          freshMap[id] = (photos as Parameters<typeof toClientPhoto>[0][]).map(
            toClientPhoto,
          );
        }
        const nextFromFresh = findNextPhotoNeedingApproval(
          products,
          currentProductId,
          freshMap,
        );
        if (nextFromFresh) {
          return nextFromFresh.product._id;
        }
      }
    } catch {
      // Fall through to stale map / product-flag dual-read.
    }

    const nextFromPhotos = photosByProductId
      ? findNextPhotoNeedingApproval(
          products,
          currentProductId,
          photosByProductId,
        )
      : null;
    return (
      nextFromPhotos?.product._id ??
      findNextPhotoNeedingApproval(products, currentProductId)?._id ??
      null
    );
  }

  async function handleApprove() {
    if (!product || isBusy || !currentPair) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsApproving(true);

    try {
      if (!currentPair.isLegacy && currentPair.ai) {
        await approveAiPhoto(currentPair.ai._id as Id<"productPhotos">);

        const nextLocalIndex = pairs.findIndex(
          (pair, index) =>
            index > safePairIndex &&
            pair.ai != null &&
            needsAiPhotoApproval(pair.ai),
        );
        const wrapLocalIndex =
          nextLocalIndex >= 0
            ? nextLocalIndex
            : pairs.findIndex(
                (pair, index) =>
                  index < safePairIndex &&
                  pair.ai != null &&
                  needsAiPhotoApproval(pair.ai),
              );

        if (wrapLocalIndex >= 0) {
          setPairIndex(wrapLocalIndex);
          setActiveView("ai");
          return;
        }

        const nextProductId = await resolveNextProductNeedingApproval(
          product._id,
        );

        if (nextProductId) {
          onOpenProduct(nextProductId);
        } else {
          onClose();
        }
      } else {
        await approvePhoto(product._id);

        const nextProductId = await resolveNextProductNeedingApproval(
          product._id,
        );

        if (nextProductId) {
          onOpenProduct(nextProductId);
        } else {
          onClose();
        }
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not approve the AI photo.",
      );
    } finally {
      setIsApproving(false);
    }
  }

  async function handleDeleteOriginal() {
    if (!product || isBusy || !currentPair?.original || currentPair.isLegacy) {
      return;
    }

    const confirmed =
      product.shopifyStatus === "published"
        ? window.confirm(
            "This product is published. Delete its photo anyway?",
          )
        : true;

    if (!confirmed) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsDeleting(true);

    try {
      await deleteProductPhoto(
        currentPair.original._id as Id<"productPhotos">,
        { confirmPublishedDelete: product.shopifyStatus === "published" },
      );
      setPairIndex((index) => Math.max(0, Math.min(index, pairs.length - 2)));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete the photo.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  const footerButtonClass = "h-9 shrink-0 px-2.5 text-xs sm:px-3 sm:text-sm";

  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            handleClose();
          }
        }}
        open={product !== null}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="min-w-0 overflow-hidden pr-6">
            <DialogTitle className="truncate" title={product?.name}>
              {product?.name ?? "Product photo"}
            </DialogTitle>
            <DialogDescription className="truncate font-mono">
              {product?.sku}
            </DialogDescription>
          </DialogHeader>

          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => void handleFileChange(event)}
            ref={fileInputRef}
            type="file"
          />

          {hasPhotoTabs ? (
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  activeView === "original"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600",
                )}
                onClick={() => switchView("original")}
                type="button"
              >
                Original
              </button>
              <button
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  activeView === "ai"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600",
                )}
                disabled={!originalUrl && !aiGenerating && !aiFailed && !aiUrl}
                onClick={() => switchView("ai")}
                type="button"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI
              </button>
            </div>
          ) : null}

          <div
            className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-100"
            onTouchEnd={handleTouchEnd}
            onTouchStart={handleTouchStart}
          >
            {photosLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm font-medium">Loading photos…</span>
              </div>
            ) : displayUrl ? (
              <img
                alt={`${activeView === "ai" ? "AI" : "Original"} photo for ${product?.sku ?? "product"}`}
                className="absolute inset-0 h-full w-full object-cover"
                src={displayUrl}
              />
            ) : activeView === "ai" && aiGenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm font-medium">Generating AI photo…</span>
              </div>
            ) : activeView === "ai" && aiFailed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-red-600">
                <AlertCircle className="h-8 w-8" />
                <span className="text-sm font-medium">
                  {currentPair?.ai?.aiError ??
                    product?.aiImageError ??
                    "AI photo generation failed."}
                </span>
              </div>
            ) : activeView === "ai" && aiAbsent ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-slate-500">
                <Sparkles className="h-8 w-8" />
                <span className="text-sm font-medium">
                  No AI photo yet. Tap Regen to generate one.
                </span>
              </div>
            ) : currentPair?.original?.status === "uploading" &&
              !currentPair.original.url ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm font-medium">Uploading photo…</span>
              </div>
            ) : (
              <button
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canAddPhoto || isBusy}
                onClick={() => handleTakePhoto("add")}
                type="button"
              >
                <Camera className="h-8 w-8" />
                <span className="text-sm font-medium">
                  {originalCount > 0 ? "Add photo" : "Take photo"}
                </span>
              </button>
            )}
            {previewUrl ? (
              <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {captureMode === "replace" ? "Replace photo" : "New photo"}
              </span>
            ) : null}
            {pairPositionLabel && !previewUrl ? (
              <span className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {pairPositionLabel}
              </span>
            ) : null}
            {activeView === "ai" && aiGenerating && displayUrl ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            ) : null}

            {canNavigatePairs ? (
              <>
                <button
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-40"
                  disabled={safePairIndex <= 0 || isBusy}
                  onClick={() => goToPair(safePairIndex - 1)}
                  type="button"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-40"
                  disabled={safePairIndex >= pairs.length - 1 || isBusy}
                  onClick={() => goToPair(safePairIndex + 1)}
                  type="button"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </div>

          {canNavigatePairs ? (
            <div className="flex items-center justify-center gap-1.5">
              {pairs.map((pair, index) => (
                <button
                  aria-label={`Photo ${index + 1}`}
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors",
                    index === safePairIndex ? "bg-slate-700" : "bg-slate-300",
                  )}
                  key={pair.original?._id ?? pair.ai?._id ?? index}
                  onClick={() => goToPair(index)}
                  type="button"
                />
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="text-sm font-medium text-red-600">{error}</p>
          ) : null}
          {stage ? (
            <p className="text-sm font-medium text-slate-600">{stage}</p>
          ) : null}
          {!canTakePhoto ? (
            <p className="text-sm text-slate-500">
              Assign this product to a group to take its photo.
            </p>
          ) : null}

          <DialogFooter className="flex flex-row flex-nowrap items-center gap-1.5 overflow-x-auto sm:justify-start">
            {activeView === "ai" && !captureFile ? (
              <>
                <Button
                  className={footerButtonClass}
                  disabled={isBusy || aiGenerating || photosLoading}
                  onClick={openPromptDialog}
                  variant="outline"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Prompt
                </Button>
                <Button
                  className={footerButtonClass}
                  disabled={
                    isBusy ||
                    aiGenerating ||
                    photosLoading ||
                    (!originalUrl && !currentPair?.original)
                  }
                  onClick={() => void handleRegenerate()}
                  variant="outline"
                >
                  {isRegenerating || aiGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  Regen
                </Button>
                {currentAiNeedsApproval ? (
                  <Button
                    className={footerButtonClass}
                    disabled={isBusy}
                    onClick={() => void handleApprove()}
                  >
                    {isApproving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Approve →
                  </Button>
                ) : null}
              </>
            ) : captureFile ? (
              <>
                <Button
                  className={footerButtonClass}
                  disabled={isBusy}
                  onClick={resetCapture}
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  className={footerButtonClass}
                  disabled={isBusy}
                  onClick={() => handleTakePhoto(captureMode)}
                  variant="outline"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Retake
                </Button>
                <Button
                  className={footerButtonClass}
                  disabled={!canSaveCapture}
                  onClick={() => void handleSave()}
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save
                </Button>
              </>
            ) : showExistingOriginalActions ? (
              <>
                <Button
                  className={footerButtonClass}
                  disabled={!canAddPhoto || isBusy}
                  onClick={() => handleTakePhoto("add")}
                  variant="outline"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Add photo
                </Button>
                <Button
                  className={footerButtonClass}
                  disabled={!canReplacePhoto || isBusy}
                  onClick={() => handleTakePhoto("replace")}
                  variant="outline"
                >
                  <Replace className="h-3.5 w-3.5" />
                  Replace photo
                </Button>
                <Button
                  className={footerButtonClass}
                  disabled={isBusy}
                  onClick={() => void handleDeleteOriginal()}
                  variant="outline"
                >
                  {isDeleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Delete
                </Button>
              </>
            ) : (
              <Button
                className={footerButtonClass}
                disabled={!canAddPhoto || isBusy}
                onClick={() => handleTakePhoto("add")}
                variant="outline"
              >
                <Camera className="h-3.5 w-3.5" />
                {originalCount > 0 ? "Add photo" : "Take photo"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setPromptDialogOpen} open={promptDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI prompt</DialogTitle>
            <DialogDescription>
              Used for the next regeneration of {product?.sku ?? "this product"}.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-slate-950/10 focus:ring-2"
            disabled={isBusy || aiGenerating}
            onChange={(event) => setDraftPrompt(event.currentTarget.value)}
            value={draftPrompt}
          />
          <DialogFooter>
            <Button
              disabled={isBusy || aiGenerating}
              onClick={() => setPromptDialogOpen(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={isBusy || aiGenerating || !draftPrompt.trim()}
              onClick={savePrompt}
            >
              Save prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
