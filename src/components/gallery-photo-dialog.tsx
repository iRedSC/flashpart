import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Loader2, Upload, X } from "lucide-react";
import {
  PhotoReviewDialog,
  photoReviewFooterButtonClass,
  type PhotoReviewView,
} from "./photo-review-dialog";
import { Button } from "./ui/button";
import { useAppData } from "../data/app-data-provider";
import {
  DEFAULT_AI_IMAGE_PROMPT,
  aiImageModelShortLabel,
  type AiImageModelId,
} from "../lib/ai-image-settings";
import { convexApi } from "../lib/convex-api";
import { triggerHaptic } from "../lib/haptics";
import type { Id } from "../../convex/_generated/dataModel";

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
  const removeFromShopify = useAction(
    convexApi.shopify.removeGalleryPhotoFromShopify,
  );

  const [activeView, setActiveView] = React.useState<PhotoReviewView>("ai");
  const [prompt, setPrompt] = React.useState("");
  const [draftPrompt, setDraftPrompt] = React.useState("");
  const [promptDialogOpen, setPromptDialogOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const original = pair?.original ?? null;
  const ai = pair?.ai ?? null;
  const defaultPrompt =
    settings?.aiImageDefaultPrompt?.trim() || DEFAULT_AI_IMAGE_PROMPT;
  const photosLoading = Boolean(originalPhotoId && open && pair === undefined);

  React.useEffect(() => {
    if (!open || !originalPhotoId) {
      return;
    }

    setError(null);
    setBusy(null);
    const nextPrompt = ai?.aiPrompt?.trim() || defaultPrompt;
    setPrompt(nextPrompt);
    setDraftPrompt(nextPrompt);
    setActiveView(
      ai?.aiStatus === "ready" ||
        ai?.aiStatus === "generating" ||
        ai?.aiStatus === "pending"
        ? "ai"
        : "original",
    );
  }, [open, originalPhotoId, ai?.aiPrompt, ai?.aiStatus, defaultPrompt]);

  const aiGenerating =
    ai?.aiStatus === "generating" ||
    ai?.aiStatus === "pending" ||
    ai?.status === "uploading";
  const aiReady = ai?.aiStatus === "ready" && Boolean(ai.url);
  const aiFailed = ai?.aiStatus === "failed";
  const aiAbsent = Boolean(
    activeView === "ai" && !ai?.url && !aiGenerating && !aiFailed,
  );
  const approved = ai?.approvedAt != null;
  const onShopify =
    ai?.shopifyFileStatus === "ready" || ai?.status === "promoted";
  const isBusy = busy != null;
  const aiModelLabel = ai?.aiModel
    ? aiImageModelShortLabel(ai.aiModel as AiImageModelId)
    : null;

  async function handleRegen(model?: AiImageModelId) {
    if (!originalPhotoId || isBusy || aiGenerating) {
      return;
    }

    setBusy("regen");
    setError(null);
    setActiveView("ai");

    try {
      await regenerate({
        sessionToken: session.sessionToken,
        originalPhotoId,
        prompt: prompt.trim() || undefined,
        model,
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
    if (!ai || isBusy) {
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
    if (!ai || isBusy) {
      return;
    }

    setBusy("remove");
    setError(null);

    try {
      await removeFromShopify({
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

  function savePrompt() {
    const trimmed = draftPrompt.trim();
    if (!trimmed) {
      setError("Enter a prompt before saving.");
      return;
    }
    setPrompt(trimmed);
    setPromptDialogOpen(false);
    setError(null);
    triggerHaptic();
  }

  const aiFooterExtra = onShopify ? (
    <Button
      className={photoReviewFooterButtonClass}
      disabled={isBusy}
      onClick={() => void handleRemoveFromShopify()}
      variant="outline"
    >
      {busy === "remove" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <X className="h-3.5 w-3.5" />
      )}
      Remove
    </Button>
  ) : (
    <Button
      className={photoReviewFooterButtonClass}
      disabled={isBusy || aiGenerating || !aiReady || !ai}
      onClick={() => void handleUploadToShopify()}
    >
      {busy === "upload" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : approved ? (
        <Upload className="h-3.5 w-3.5" />
      ) : (
        <Check className="h-3.5 w-3.5" />
      )}
      {approved ? "Upload" : "Approve →"}
    </Button>
  );

  return (
    <PhotoReviewDialog
      activeView={activeView}
      aiAbsent={aiAbsent}
      aiError={ai?.aiError ?? null}
      aiFailed={aiFailed}
      aiFooterExtra={activeView === "ai" ? aiFooterExtra : null}
      aiGenerating={aiGenerating}
      aiModelLabel={aiModelLabel}
      aiTabDisabled={
        !original?.url && !aiGenerating && !aiFailed && !ai?.url
      }
      aiUrl={ai?.url ?? null}
      busy={isBusy}
      canRegenerate={Boolean(original?.url || original?.storageId)}
      defaultPrompt={defaultPrompt}
      draftPrompt={draftPrompt}
      error={error}
      onActiveViewChange={setActiveView}
      onDraftPromptChange={setDraftPrompt}
      onOpenChange={onOpenChange}
      onOpenPrompt={() => {
        setDraftPrompt(prompt);
        setPromptDialogOpen(true);
      }}
      onPromptDialogOpenChange={setPromptDialogOpen}
      onRegenerate={(model) => void handleRegen(model)}
      onSavePrompt={savePrompt}
      onUseDefaultPrompt={() => {
        setDraftPrompt(defaultPrompt);
        triggerHaptic();
      }}
      open={open}
      originalUrl={original?.url ?? null}
      photosLoading={photosLoading}
      promptDescription="Used for the next regeneration of this gallery photo."
      promptDialogOpen={promptDialogOpen}
      regenerating={busy === "regen"}
      showViewTabs={Boolean(original || ai || aiGenerating || aiFailed)}
      title="Edit photo"
    />
  );
}
