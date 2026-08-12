import * as React from "react";
import { useConvex, useQuery } from "convex/react";
import {
  Camera,
  Check,
  Loader2,
  Replace,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  PhotoReviewDialog,
  photoReviewFooterButtonClass,
} from "./photo-review-dialog";
import { useAppData } from "../data/app-data-provider";
import { cropImageFileToSquare } from "../lib/capture-image";
import { convexApi } from "../lib/convex-api";
import { triggerHaptic } from "../lib/haptics";
import {
  DEFAULT_AI_IMAGE_PROMPT,
  aiImageModelShortLabel,
  type AiImageModelId,
} from "../lib/ai-image-settings";
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
  productId?: Id<"products">;
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
  aiModel?: AiImageModelId;
  captureId?: Id<"captures">;
  createdAt: number;
  updatedAt: number;
}): ProductPhoto {
  return {
    _id: photo._id,
    productId: photo.productId ?? "",
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
    aiModel: photo.aiModel,
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
            aiModel: product.aiImageModel as AiImageModelId | undefined,
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
    whitenAiBackground,
  } = useAppData();
  const convex = useConvex();
  const defaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;
  const maxProductPhotos = settings?.maxProductPhotos ?? 5;
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const initializedForProductRef = React.useRef<string | null>(null);
  /** After add, focus the new pair once listByProduct includes this original. */
  const pendingFocusOriginalIdRef = React.useRef<string | null>(null);
  const [captureFile, setCaptureFile] = React.useState<File | null>(null);
  const [captureMode, setCaptureMode] = React.useState<CaptureMode>("add");
  const [activeView, setActiveView] = React.useState<PhotoView>("ai");
  const [pairIndex, setPairIndex] = React.useState(0);
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [draftPrompt, setDraftPrompt] = React.useState(defaultPrompt);
  const [promptDirty, setPromptDirty] = React.useState(false);
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [isWhitening, setIsWhitening] = React.useState(false);
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
    setPromptDirty(false);
    setPairIndex(0);
    setError(null);
    setStage(null);
    setCaptureFile(null);
    setCaptureMode("add");
    setPromptDialogOpen(false);
    setIsWhitening(false);
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
        setPromptDirty(false);
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
      setPromptDirty(false);
    }

    const firstNeedingApproval = pairs.findIndex(
      (pair) => pair.ai != null && needsAiPhotoApproval(pair.ai),
    );

    if (firstNeedingApproval >= 0) {
      setPairIndex(firstNeedingApproval);
      setActiveView("ai");
      setPromptDirty(false);
    }
  }, [product?._id, productPhotos, pairs]);

  // Clamp pair index when pairs shrink (e.g. after delete) — avoid stale closure.
  React.useEffect(() => {
    if (pendingFocusOriginalIdRef.current) {
      return;
    }
    if (pairs.length === 0) {
      if (pairIndex !== 0) {
        setPairIndex(0);
      }
      return;
    }
    if (pairIndex > pairs.length - 1) {
      setPairIndex(pairs.length - 1);
    }
  }, [pairIndex, pairs.length]);

  // Keep prompt in sync with the active pair unless the user has dirty edits.
  const currentPairAiPrompt = currentPair?.ai?.aiPrompt;
  const currentPairOriginalId = currentPair?.original?._id;
  const currentPairAiId = currentPair?.ai?._id;
  const currentPairIsLegacy = currentPair?.isLegacy === true;
  React.useEffect(() => {
    if (!currentPair || promptDirty) {
      return;
    }

    const pairPrompt =
      currentPairAiPrompt?.trim() ||
      (currentPairIsLegacy ? product?.aiImagePrompt?.trim() : undefined) ||
      defaultPrompt;
    setPrompt(pairPrompt);
    setDraftPrompt(pairPrompt);
  }, [
    currentPair,
    currentPairAiId,
    currentPairAiPrompt,
    currentPairIsLegacy,
    currentPairOriginalId,
    defaultPrompt,
    product?.aiImagePrompt,
    promptDirty,
    safePairIndex,
  ]);

  const originalUrl =
    previewUrl ??
    currentPair?.original?.url ??
    (currentPair?.isLegacy ? (product?.shopifyFileUrl ?? null) : null);
  const aiUrl =
    currentPair?.ai?.url ??
    (currentPair?.isLegacy ? (product?.aiShopifyFileUrl ?? null) : null);
  const aiModelUsed =
    currentPair?.ai?.aiModel ??
    (currentPair?.isLegacy
      ? (product?.aiImageModel as AiImageModelId | undefined)
      : undefined);
  const aiModelLabel = aiModelUsed
    ? aiImageModelShortLabel(aiModelUsed)
    : null;
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
  const isBusy =
    isSaving || isRegenerating || isWhitening || isApproving || isDeleting;
  const originalCount = pairs.filter((pair) => pair.original != null).length;
  const isLegacyOnly =
    pairs.length > 0 && pairs.every((pair) => pair.isLegacy);
  // U3: once photos loaded, enforce max. Block add on pure legacy until migrated.
  const canAddPhoto =
    canTakePhoto &&
    !photosLoading &&
    !isLegacyOnly &&
    originalCount < maxProductPhotos;
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
      const confirmed = window.confirm(
        "A photo action is still in progress. Close anyway?",
      );
      if (!confirmed) {
        return;
      }
      setIsSaving(false);
      setIsRegenerating(false);
      setIsApproving(false);
      setIsDeleting(false);
      setStage(null);
    }

    resetCapture();
    setPromptDialogOpen(false);
    setPromptDirty(false);
    onClose();
  }

  function switchView(view: PhotoView) {
    setActiveView(view);
    setError(null);
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
    setPromptDirty(true);
    setError(null);
    setPromptDialogOpen(false);
    triggerHaptic();
  }

  function applyDefaultPrompt() {
    setDraftPrompt(defaultPrompt);
    triggerHaptic();
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
      setPromptDirty(false);
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

  async function handleRegenerate(model?: AiImageModelId) {
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
          model,
        });
      } else {
        await regenerateAiImage({
          productId: product._id,
          prompt,
          model,
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

  async function handleWhitenBackground() {
    if (!product || isBusy || aiGenerating || !aiUrl) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsWhitening(true);

    try {
      await whitenAiBackground({
        productId: product._id,
        originalPhotoId:
          currentPair && !currentPair.isLegacy && currentPair.original
            ? (currentPair.original._id as Id<"productPhotos">)
            : undefined,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not whiten the AI background.",
      );
    } finally {
      setIsWhitening(false);
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

    // Only use the parent map when it covers every product — a filtered/
    // partial map would treat missing ids as [] and skip products needing review.
    const photosMapComplete =
      photosByProductId != null &&
      products.every((entry) => entry._id in photosByProductId);
    const nextFromPhotos = photosMapComplete
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
          setPromptDirty(false);
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
      // Pair index is clamped by the pairs.length effect after the list updates.
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

  const footerOverride = captureFile ? (
    <>
      <Button
        className={photoReviewFooterButtonClass}
        disabled={isBusy}
        onClick={resetCapture}
        variant="ghost"
      >
        Cancel
      </Button>
      <Button
        className={photoReviewFooterButtonClass}
        disabled={isBusy}
        onClick={() => handleTakePhoto(captureMode)}
        variant="outline"
      >
        <Camera className="h-3.5 w-3.5" />
        Retake
      </Button>
      <Button
        className={photoReviewFooterButtonClass}
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
        className={photoReviewFooterButtonClass}
        disabled={!canAddPhoto || isBusy}
        onClick={() => handleTakePhoto("add")}
        variant="outline"
      >
        <Camera className="h-3.5 w-3.5" />
        Add photo
      </Button>
      <Button
        className={photoReviewFooterButtonClass}
        disabled={!canReplacePhoto || isBusy}
        onClick={() => handleTakePhoto("replace")}
        variant="outline"
      >
        <Replace className="h-3.5 w-3.5" />
        Replace photo
      </Button>
      <Button
        className={photoReviewFooterButtonClass}
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
  ) : activeView === "original" ? (
    <Button
      className={photoReviewFooterButtonClass}
      disabled={!canAddPhoto || isBusy}
      onClick={() => handleTakePhoto("add")}
      variant="outline"
    >
      <Camera className="h-3.5 w-3.5" />
      {originalCount > 0 ? "Add photo" : "Take photo"}
    </Button>
  ) : undefined;

  const aiFooterExtra = currentAiNeedsApproval ? (
    <Button
      className={photoReviewFooterButtonClass}
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
  ) : null;

  return (
    <>
      <input
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => void handleFileChange(event)}
        ref={fileInputRef}
        type="file"
      />
      <PhotoReviewDialog
        activeView={activeView}
        aiAbsent={aiAbsent}
        aiError={
          currentPair?.ai?.aiError ?? product?.aiImageError ?? null
        }
        aiFailed={aiFailed}
        aiFooterExtra={aiFooterExtra}
        aiGenerating={aiGenerating}
        aiModelLabel={aiModelLabel}
        aiTabDisabled={!originalUrl && !aiGenerating && !aiFailed && !aiUrl}
        aiUrl={aiUrl}
        busy={isBusy}
        canRegenerate={Boolean(originalUrl || currentPair?.original)}
        defaultPrompt={defaultPrompt}
        description={product?.sku}
        draftPrompt={draftPrompt}
        emptyOriginalDisabled={!canAddPhoto || isBusy}
        emptyOriginalLabel={originalCount > 0 ? "Add photo" : "Take photo"}
        error={error}
        footerOverride={footerOverride}
        notice={
          !canTakePhoto
            ? "Assign this product to a group to take its photo."
            : null
        }
        onActiveViewChange={switchView}
        onDraftPromptChange={setDraftPrompt}
        onEmptyOriginalClick={() => handleTakePhoto("add")}
        onOpenChange={(open) => {
          if (!open) {
            handleClose();
          }
        }}
        onOpenPrompt={openPromptDialog}
        onPairIndexChange={(index) => {
          setPairIndex(index);
          setPromptDirty(false);
          setError(null);
        }}
        onPromptDialogOpenChange={setPromptDialogOpen}
        onRegenerate={(model) => void handleRegenerate(model)}
        onSavePrompt={savePrompt}
        onUseDefaultPrompt={applyDefaultPrompt}
        onWhiten={() => void handleWhitenBackground()}
        open={product !== null}
        originalUrl={originalUrl}
        pairCount={pairs.length}
        pairIndex={safePairIndex}
        pairPositionLabel={pairPositionLabel}
        photosLoading={photosLoading}
        previewBadge={
          previewUrl
            ? captureMode === "replace"
              ? "Replace photo"
              : "New photo"
            : null
        }
        previewUrl={previewUrl}
        promptDescription={`Used for the next regeneration of ${product?.sku ?? "this product"}.`}
        promptDialogOpen={promptDialogOpen}
        regenerating={isRegenerating}
        showViewTabs={hasPhotoTabs}
        showWhiten={Boolean(aiUrl && !aiGenerating && !aiFailed)}
        stage={stage}
        title={product?.name ?? "Product photo"}
        whitening={isWhitening}
      />
    </>
  );
}
