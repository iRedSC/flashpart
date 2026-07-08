import * as React from "react";
import {
  AlertCircle,
  Camera,
  Check,
  ImageOff,
  Loader2,
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
import {
  DEFAULT_AI_IMAGE_PROMPT,
  isAiImageFailed,
  isAiImageGenerating,
} from "../lib/product-photo";
import { cn } from "../lib/utils";

type Product = ReturnType<typeof useAppData>["products"][number];
type PhotoView = "original" | "ai";

export function ProductPhotoDialog({
  onClose,
  product,
}: {
  onClose: () => void;
  product: Product | null;
}) {
  const { approvePhoto, recordCapture, regenerateAiImage, uploadCaptureImage } =
    useAppData();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const touchStartXRef = React.useRef<number | null>(null);
  const [retakeFile, setRetakeFile] = React.useState<File | null>(null);
  const [activeView, setActiveView] = React.useState<PhotoView>("ai");
  const [prompt, setPrompt] = React.useState(DEFAULT_AI_IMAGE_PROMPT);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [isApproving, setIsApproving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<string | null>(null);
  const previewUrl = React.useMemo(
    () => (retakeFile ? URL.createObjectURL(retakeFile) : null),
    [retakeFile],
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

    setPrompt(product.aiImagePrompt ?? DEFAULT_AI_IMAGE_PROMPT);
    setActiveView(
      isAiImageGenerating(product) || isAiImageFailed(product) ? "original" : "ai",
    );
    setError(null);
    setStage(null);
    setRetakeFile(null);
  }, [product?._id, product?.aiImageStatus, product?.aiImagePrompt]);

  const originalUrl = previewUrl ?? product?.shopifyFileUrl ?? null;
  const aiUrl = product?.aiShopifyFileUrl ?? null;
  const aiGenerating = product ? isAiImageGenerating(product) : false;
  const aiFailed = product ? isAiImageFailed(product) : false;
  const canRetake = Boolean(product?.groupId);
  const isBusy = isSaving || isRegenerating || isApproving;

  const displayUrl =
    activeView === "ai"
      ? aiUrl
      : originalUrl;

  function resetRetake() {
    setRetakeFile(null);
    setError(null);
    setStage(null);
  }

  function handleClose() {
    if (isBusy) {
      return;
    }

    resetRetake();
    onClose();
  }

  function switchView(view: PhotoView) {
    setActiveView(view);
    setError(null);
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const startX = touchStartXRef.current;

    if (startX === null || retakeFile) {
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
      setRetakeFile(await cropImageFileToSquare(file));
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

  async function handleSave() {
    if (!product?.groupId || !retakeFile || isBusy) {
      return;
    }

    triggerHaptic();
    setError(null);
    setIsSaving(true);

    try {
      setStage("Uploading photo to Shopify...");
      const shopifyFile = await uploadCaptureImage(retakeFile);

      setStage("Saving photo...");
      await recordCapture({
        groupId: product.groupId,
        productId: product._id,
        ...shopifyFile,
      });
      triggerHaptic();
      resetRetake();
      setPrompt(DEFAULT_AI_IMAGE_PROMPT);
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

        {originalUrl || aiUrl || aiGenerating || aiFailed ? (
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
              <ImageOff className="h-8 w-8" />
              <span className="text-sm">No photo yet</span>
            </div>
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

        {activeView === "ai" && !retakeFile ? (
          <div className="space-y-3">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">AI prompt</span>
              <textarea
                className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-slate-950/10 focus:ring-2"
                disabled={isBusy || aiGenerating}
                onChange={(event) => setPrompt(event.target.value)}
                value={prompt}
              />
            </label>
            <div className="flex flex-wrap gap-2">
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
              {product?.needsPhotoReview && aiUrl ? (
                <Button disabled={isBusy} onClick={() => void handleApprove()}>
                  {isApproving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Approve photo
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm font-medium text-red-600">{error}</p>
        ) : null}
        {stage ? (
          <p className="text-sm font-medium text-slate-600">{stage}</p>
        ) : null}
        {!canRetake ? (
          <p className="text-sm text-slate-500">
            Assign this product to a group to retake its photo.
          </p>
        ) : null}

        <DialogFooter>
          {retakeFile ? (
            <>
              <Button disabled={isBusy} onClick={resetRetake} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
              >
                <RefreshCcw className="h-4 w-4" />
                Retake
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
              disabled={!canRetake}
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
            >
              <Camera className="h-4 w-4" />
              {product?.shopifyFileUrl ? "Retake photo" : "Take photo"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
