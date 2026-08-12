import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Loader2,
  RefreshCcw,
  Upload,
  X,
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
import {
  DEFAULT_AI_IMAGE_PROMPT,
  type AiImageModelId,
} from "../lib/ai-image-settings";
import { convexApi } from "../lib/convex-api";
import { triggerHaptic } from "../lib/haptics";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type PhotoView = "original" | "edited";

type GalleryPhotoDialogProps = {
  originalPhotoId: Id<"productPhotos"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function GalleryPhotoDialog({
  originalPhotoId,
  open,
  onOpenChange,
}: GalleryPhotoDialogProps) {
  const { session, settings } = useAppData();
  const pair = useQuery(
    convexApi.galleryPhotos.getPair,
    originalPhotoId && open
      ? {
          sessionToken: session.sessionToken,
          originalPhotoId,
        }
      : "skip",
  );
  const regenerate = useMutation(convexApi.galleryPhotos.regenerate);
  const approveAiPhoto = useMutation(convexApi.galleryPhotos.approveAiPhoto);
  const promotePhoto = useAction(convexApi.shopify.promotePhotoToShopify);
  const deleteShopifyPhoto = useAction(
    convexApi.shopify.removeGalleryPhotoFromShopify,
  );

  const [view, setView] = React.useState<PhotoView>("edited");
  const [prompt, setPrompt] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const original = pair?.original ?? null;
  const ai = pair?.ai ?? null;
  const defaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;

  React.useEffect(() => {
    if (!open || !originalPhotoId) {
      return;
    }

    setError(null);
    setBusy(null);
    setPrompt(ai?.aiPrompt?.trim() || defaultPrompt);
    setView(
      ai?.aiStatus === "ready" || ai?.aiStatus === "generating"
        ? "edited"
        : "original",
    );
  }, [open, originalPhotoId, ai?.aiPrompt, ai?.aiStatus, defaultPrompt]);

  const aiGenerating =
    ai?.aiStatus === "generating" ||
    ai?.aiStatus === "pending" ||
    ai?.status === "uploading";
  const aiReady = ai?.aiStatus === "ready" && Boolean(ai.url);
  const aiFailed = ai?.aiStatus === "failed";
  const approved = ai?.approvedAt != null;
  const onShopify =
    ai?.shopifyFileStatus === "ready" || ai?.status === "promoted";
  const displayUrl =
    view === "edited" ? (ai?.url ?? null) : (original?.url ?? null);

  async function handleRegen() {
    if (!originalPhotoId || busy) {
      return;
    }

    setBusy("regen");
    setError(null);
    setView("edited");

    try {
      await regenerate({
        sessionToken: session.sessionToken,
        originalPhotoId,
        prompt: prompt.trim() || undefined,
      });
      triggerHaptic();
    } catch (regenError) {
      setError(
        regenError instanceof Error
          ? regenError.message
          : "Could not regenerate the edited photo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleUploadToShopify() {
    if (!ai || busy) {
      return;
    }

    setBusy("upload");
    setError(null);

    try {
      if (!approved) {
        await approveAiPhoto({
          sessionToken: session.sessionToken,
          photoId: ai._id,
        });
      }

      await promotePhoto({
        sessionToken: session.sessionToken,
        photoId: ai._id,
      });
      triggerHaptic();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload to Shopify.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveFromShopify() {
    if (!ai || busy) {
      return;
    }

    setBusy("remove");
    setError(null);

    try {
      await deleteShopifyPhoto({
        sessionToken: session.sessionToken,
        photoId: ai._id,
      });
      triggerHaptic();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove from Shopify.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit photo</DialogTitle>
          <DialogDescription>
            Review the AI edit, then upload it to Shopify Files.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            onClick={() => setView("original")}
            size="sm"
            type="button"
            variant={view === "original" ? "default" : "outline"}
          >
            Original
          </Button>
          <Button
            onClick={() => setView("edited")}
            size="sm"
            type="button"
            variant={view === "edited" ? "default" : "outline"}
          >
            Edited
          </Button>
        </div>

        <div className="relative aspect-square overflow-hidden rounded-md bg-slate-100">
          {displayUrl ? (
            <img
              alt=""
              className="h-full w-full object-cover"
              src={displayUrl}
            />
          ) : view === "edited" && aiGenerating ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm font-medium">Editing photo…</span>
            </div>
          ) : view === "edited" && aiFailed ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-slate-600">
              <p className="text-sm font-medium">
                {ai?.aiError ?? "Editing failed."}
              </p>
            </div>
          ) : view === "edited" ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
              No edited photo yet. Tap Regenerate.
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Original unavailable
            </div>
          )}

          {view === "edited" && aiGenerating && displayUrl ? (
            <div className="absolute inset-x-0 bottom-0 bg-slate-950/70 px-3 py-2 text-center text-xs text-white">
              Regenerating…
            </div>
          ) : null}

          {view === "edited" && onShopify ? (
            <div className="absolute left-2 top-2 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">
              On Shopify
            </div>
          ) : null}

          {view === "edited" && aiReady && !approved && !onShopify ? (
            <div className="absolute left-2 top-2 rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white">
              Needs review
            </div>
          ) : null}
        </div>

        <label className="grid gap-2 text-sm font-medium">
          Edit prompt
          <textarea
            className="min-h-20 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
            disabled={Boolean(busy) || aiGenerating}
            onChange={(event) => setPrompt(event.target.value)}
            value={prompt}
          />
        </label>

        {ai?.aiModel ? (
          <p className="text-xs text-slate-500">
            Model: {ai.aiModel as AiImageModelId}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex w-full flex-wrap gap-2">
            <Button
              className="flex-1"
              disabled={Boolean(busy) || aiGenerating || !originalPhotoId}
              onClick={() => void handleRegen()}
              type="button"
              variant="outline"
            >
              {busy === "regen" || aiGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Regenerate
            </Button>

            {onShopify ? (
              <Button
                className="flex-1"
                disabled={Boolean(busy)}
                onClick={() => void handleRemoveFromShopify()}
                type="button"
                variant="outline"
              >
                {busy === "remove" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Remove from Shopify
              </Button>
            ) : (
              <Button
                className={cn("flex-1")}
                disabled={
                  Boolean(busy) ||
                  aiGenerating ||
                  !aiReady ||
                  !ai
                }
                onClick={() => void handleUploadToShopify()}
                type="button"
              >
                {busy === "upload" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : approved ? (
                  <Upload className="h-4 w-4" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {approved ? "Upload to Shopify" : "Approve & upload"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
