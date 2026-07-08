import * as React from "react";
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  PencilLine,
  RefreshCcw,
  Sparkles,
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
import { triggerHaptic } from "../lib/haptics";
import { DEFAULT_AI_IMAGE_PROMPT } from "../lib/ai-image-settings";
import {
  findNextPhotoNeedingApproval,
  isAiImageFailed,
  isAiImageGenerating,
  needsPhotoApproval,
} from "../lib/product-photo";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];
type PhotoView = "original" | "ai";

export function ProductPhotoDialog({
  onClose,
  onOpenProduct,
  product,
}: {
  onClose: () => void;
  onOpenProduct: (productId: Id<"products">) => void;
  product: Product | null;
}) {
  const {
    approvePhoto,
    products,
    recordCapture,
    regenerateAiImage,
    settings,
    uploadCaptureImage,
  } = useAppData();
  const defaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const touchStartXRef = React.useRef<number | null>(null);
  const [captureFile, setCaptureFile] = React.useState<File | null>(null);
  const [activeView, setActiveView] = React.useState<PhotoView>("ai");
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [draftPrompt, setDraftPrompt] = React.useState(defaultPrompt);
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [isApproving, setIsApproving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<string | null>(null);
  const previewUrl = React.useMemo(
    () => (captureFile ? URL.createObjectURL(captureFile) : null),
    [captureFile],
  );

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  React.useEffect(() => {
    if (!product) {
      return;
    }

    const nextPrompt = product.aiImagePrompt ?? defaultPrompt;
    setPrompt(nextPrompt);
    setDraftPrompt(nextPrompt);
    setActiveView(
      isAiImageGenerating(product) || isAiImageFailed(product) ? "original" : "ai",
    );
    setError(null);
    setStage(null);
    setCaptureFile(null);
    setPromptDialogOpen(false);
  }, [defaultPrompt, product?._id, product?.aiImageStatus, product?.aiImagePrompt]);

  const originalUrl = previewUrl ?? product?.shopifyFileUrl ?? null;
  const aiUrl = product?.aiShopifyFileUrl ?? null;
  const aiGenerating = product ? isAiImageGenerating(product) : false;
  const aiFailed = product ? isAiImageFailed(product) : false;
  const canTakePhoto = Boolean(product?.groupId);
  const isBusy = isSaving || isRegenerating || isApproving;
  const hasPhotoTabs = Boolean(originalUrl || aiUrl || aiGenerating || aiFailed);

  const displayUrl = activeView === "ai" ? aiUrl : originalUrl;

  function resetCapture() {
    setCaptureFile(null);
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

  function openPromptDialog() {
    setDraftPrompt(prompt);
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

    if (startX === null || captureFile) {
      return;
    }

    const endX = event.changedTouches[0]?.clientX ?? startX;
    const deltaX = endX - startX;

    if (Math.abs(deltaX) < 48) {
      return;
    }

    if (deltaX < 0 && activeView === "original" && (aiUrl || aiGenerating || aiFailed)) {
      switchView("ai");
      triggerHaptic();
    }

    if (deltaX > 0 && activeView === "ai") {
      switchView("original");
      triggerHaptic();
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

  function handleTakePhoto() {
    fileInputRef.current?.click();
  }

  async function handleSave() {
    if (!product?.groupId || !captureFile || isBusy) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsSaving(true);

    try {
      setStage("Uploading photo to Shopify...");
      const shopifyFile = await uploadCaptureImage(captureFile);

      setStage("Saving photo...");
      await recordCapture({
        groupId: product.groupId,
        productId: product._id,
        ...shopifyFile,
      });
      triggerHaptic();
      resetCapture();
      setPrompt(defaultPrompt);
      setDraftPrompt(defaultPrompt);
      setActiveView("ai");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Shopify photo upload failed. Check your connection and retry.",
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
      await regenerateAiImage({
        productId: product._id,
        prompt,
      });
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

  async function handleApprove() {
    if (!product || isBusy) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsApproving(true);

    try {
      await approvePhoto(product._id);
      const nextProduct = findNextPhotoNeedingApproval(products, product._id);

      if (nextProduct) {
        onOpenProduct(nextProduct._id);
      } else {
        onClose();
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
          <DialogHeader>
            <DialogTitle className="truncate pr-6">
              {product?.name ?? "Product photo"}
            </DialogTitle>
            <DialogDescription className="font-mono">
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
                disabled={!originalUrl && !aiGenerating && !aiFailed}
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
            {displayUrl ? (
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
                  {product?.aiImageError ?? "AI photo generation failed."}
                </span>
              </div>
            ) : (
              <button
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canTakePhoto || isBusy}
                onClick={handleTakePhoto}
                type="button"
              >
                <Camera className="h-8 w-8" />
                <span className="text-sm font-medium">Take photo</span>
              </button>
            )}
            {previewUrl ? (
              <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                New photo
              </span>
            ) : null}
            {activeView === "ai" && aiGenerating && displayUrl ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            ) : null}
          </div>

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

          {activeView === "ai" && !captureFile ? (
            <DialogFooter className="flex flex-row flex-wrap gap-2 sm:justify-start">
              <Button
                disabled={isBusy || aiGenerating}
                onClick={openPromptDialog}
                variant="outline"
              >
                <PencilLine className="h-4 w-4" />
                Edit prompt
              </Button>
              <Button
                disabled={isBusy || aiGenerating || !originalUrl}
                onClick={() => void handleRegenerate()}
                variant="outline"
              >
                {isRegenerating || aiGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4" />
                )}
                Regenerate
              </Button>
              {product && needsPhotoApproval(product) ? (
                <Button disabled={isBusy} onClick={() => void handleApprove()}>
                  {isApproving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Approve & next
                </Button>
              ) : null}
            </DialogFooter>
          ) : (
            <DialogFooter>
              {captureFile ? (
                <>
                  <Button disabled={isBusy} onClick={resetCapture} variant="ghost">
                    Cancel
                  </Button>
                  <Button
                    disabled={isBusy}
                    onClick={handleTakePhoto}
                    variant="outline"
                  >
                    <Camera className="h-4 w-4" />
                    Take photo
                  </Button>
                  <Button disabled={isBusy} onClick={() => void handleSave()}>
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Save photo
                  </Button>
                </>
              ) : (
                <Button
                  disabled={!canTakePhoto || isBusy}
                  onClick={handleTakePhoto}
                  variant="outline"
                >
                  <Camera className="h-4 w-4" />
                  Take photo
                </Button>
              )}
            </DialogFooter>
          )}
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
