import * as React from "react";
import { Camera, Check, ImageOff, Loader2, RefreshCcw } from "lucide-react";
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

type Product = ReturnType<typeof useAppData>["products"][number];

export function ProductPhotoDialog({
  onClose,
  product,
}: {
  onClose: () => void;
  product: Product | null;
}) {
  const { recordCapture, uploadCaptureImage } = useAppData();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [retakeFile, setRetakeFile] = React.useState<File | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
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

  const displayUrl = previewUrl ?? product?.shopifyFileUrl ?? null;
  const canRetake = Boolean(product?.groupId);

  function resetRetake() {
    setRetakeFile(null);
    setError(null);
    setStage(null);
  }

  function handleClose() {
    if (isSaving) {
      return;
    }

    resetRetake();
    onClose();
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
    if (!product?.groupId || !retakeFile || isSaving) {
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
      onClose();
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

        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-100">
          {displayUrl ? (
            <img
              alt={`Photo for ${product?.sku ?? "product"}`}
              className="absolute inset-0 h-full w-full object-cover"
              src={displayUrl}
            />
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
        </div>

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
              <Button disabled={isSaving} onClick={resetRetake} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={isSaving}
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
              >
                <RefreshCcw className="h-4 w-4" />
                Retake
              </Button>
              <Button disabled={isSaving} onClick={() => void handleSave()}>
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
