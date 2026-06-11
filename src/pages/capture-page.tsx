import * as React from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useAppData } from "../data/app-data-provider";
import { triggerHaptic } from "../lib/haptics";
import { useIsMobile } from "../lib/use-is-mobile";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

const INLINE_CAMERA_UNAVAILABLE =
  "Inline camera is not available here. Use the camera picker instead.";

function canvasToFile(
  canvas: HTMLCanvasElement,
  fileName: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Photo could not be processed. Please try again."));
          return;
        }

        resolve(
          new File([blob], fileName, {
            lastModified: Date.now(),
            type: "image/jpeg",
          }),
        );
      },
      "image/jpeg",
      0.92,
    );
  });
}

async function cropImageFileToSquare(file: File): Promise<File> {
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error("Photo could not be loaded. Please try again."));
      image.src = imageUrl;
    });

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    const canvas = document.createElement("canvas");

    canvas.width = sourceSize;
    canvas.height = sourceSize;
    canvas
      .getContext("2d")
      ?.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        sourceSize,
        sourceSize,
      );

    return await canvasToFile(
      canvas,
      `${file.name.replace(/\.[^.]+$/, "")}.jpg`,
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function CapturePage() {
  const { groupId } = useParams();
  const { groups, products, recordCapture, uploadCaptureImage } = useAppData();
  const isMobile = useIsMobile();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [isCameraReady, setIsCameraReady] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const previewUrl = React.useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : null),
    [selectedFile],
  );

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const stopCamera = React.useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setIsCameraReady(false);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const typedGroupId = groupId as Id<"groups"> | undefined;
  const group = groups.find((item) => item._id === typedGroupId);
  const groupProducts = products.filter(
    (product) => product.groupId === typedGroupId,
  );
  const nextProduct =
    groupProducts.find(
      (product) =>
        product.status === "grouped" ||
        product.status === "failed" ||
        product.status === "blockedExistingSku",
    ) ?? null;
  const completedCount = groupProducts.filter(
    (product) =>
      product.status === "captured" ||
      product.status === "processing" ||
      product.status === "needsReview" ||
      product.status === "draftCreated",
  ).length;
  const progress =
    groupProducts.length === 0
      ? 0
      : Math.round((completedCount / groupProducts.length) * 100);
  const nextProductId = nextProduct?._id;

  React.useEffect(() => {
    let isCancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(INLINE_CAMERA_UNAVAILABLE);
        return;
      }

      setCameraError(null);
      setIsCameraReady(false);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            aspectRatio: { ideal: 1 },
            facingMode: { ideal: "environment" },
            height: { ideal: 1600 },
            width: { ideal: 1600 },
          },
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (error) {
        if (!isCancelled) {
          setCameraError(
            error instanceof DOMException && error.name === "NotAllowedError"
              ? "Camera permission was denied. Use the camera picker instead."
              : INLINE_CAMERA_UNAVAILABLE,
          );
        }
      }
    }

    if (nextProductId && !selectedFile) {
      void startCamera();
    } else {
      stopCamera();
    }

    return () => {
      isCancelled = true;
      stopCamera();
    };
  }, [nextProductId, selectedFile, stopCamera]);

  const containerClass = cn(
    "mx-auto flex w-full max-w-2xl flex-col",
    isMobile && "min-h-dvh px-4 pb-[env(safe-area-inset-bottom)]",
  );

  async function handleSave(withPhoto: boolean) {
    if (!typedGroupId || !nextProduct || isSubmitting) {
      return;
    }

    triggerHaptic();
    setUploadError(null);
    setIsSubmitting(true);

    try {
      let rawImageStorageId: Id<"_storage"> | undefined;

      if (withPhoto && selectedFile) {
        try {
          rawImageStorageId = await uploadCaptureImage(selectedFile);
        } catch (error) {
          setUploadError(
            error instanceof Error
              ? error.message
              : "Photo upload failed. Check your connection and retry.",
          );
          return;
        }
      }

      await recordCapture({
        groupId: typedGroupId,
        productId: nextProduct._id,
        rawImageStorageId,
      });
      setSelectedFile(null);
      triggerHaptic();
    } catch {
      // The shared data provider reports the error and reverts optimistic state.
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCaptureFromCamera() {
    const video = videoRef.current;

    if (
      !nextProduct ||
      !video ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return;
    }

    setUploadError(null);

    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - sourceSize) / 2;
    const sourceY = (video.videoHeight - sourceSize) / 2;
    const canvas = document.createElement("canvas");

    canvas.width = sourceSize;
    canvas.height = sourceSize;
    canvas
      .getContext("2d")
      ?.drawImage(
        video,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        sourceSize,
        sourceSize,
      );

    try {
      const file = await canvasToFile(canvas, `${nextProduct.sku}-capture.jpg`);
      setSelectedFile(file);
      triggerHaptic();
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Photo could not be processed. Please try again.",
      );
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;

    setUploadError(null);
    setSelectedFile(null);
    event.currentTarget.value = "";

    if (file) {
      try {
        setSelectedFile(await cropImageFileToSquare(file));
        triggerHaptic();
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : "Photo could not be processed. Please try again.",
        );
      }
    }
  }

  if (!group) {
    return (
      <div className={cn(containerClass, isMobile && "pt-[calc(env(safe-area-inset-top)+1rem)]")}>
        <Card>
          <CardHeader>
            <CardTitle>Group not found</CardTitle>
            <CardDescription>
              Choose an active photo group before starting capture.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/groups">Back to groups</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <header
        className={cn(
          "flex items-center gap-1 pb-2",
          isMobile ? "pt-[calc(env(safe-area-inset-top)+0.5rem)]" : "pt-0",
        )}
      >
        <Link
          aria-label="Back to groups"
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors active:bg-slate-200"
          onClick={() => triggerHaptic()}
          to="/groups"
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {group.name}
        </h2>
        <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold tabular-nums text-slate-700">
          {completedCount}/{groupProducts.length}
        </span>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-950 transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {nextProduct ? (
        <div className="flex flex-1 flex-col gap-4 pt-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Next part
            </p>
            <h3 className="mt-1 text-lg font-semibold leading-snug">
              {nextProduct.name}
            </h3>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">SKU</p>
                <p className="select-text truncate font-mono text-xl font-semibold tabular-nums">
                  {nextProduct.sku}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Price</p>
                <p className="text-xl font-semibold tabular-nums">
                  ${nextProduct.price.toFixed(2)}
                </p>
              </div>
            </div>
            {nextProduct.duplicatePolicy === "blockExisting" ? (
              <p className="mt-2 text-xs text-slate-500">
                Existing SKUs are blocked for this part.
              </p>
            ) : null}
          </div>

          <div
            className={cn(
              "relative aspect-square w-full overflow-hidden rounded-2xl",
              previewUrl
                ? "bg-slate-950"
                : cameraError
                  ? "border-2 border-dashed border-slate-300 bg-white"
                  : "bg-slate-950",
            )}
          >
            <input
              accept="image/*"
              capture="environment"
              className="sr-only"
              key={nextProduct._id}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            {previewUrl ? (
              <>
                <img
                  alt={`Captured photo for ${nextProduct.sku}`}
                  className="absolute inset-0 h-full w-full object-cover"
                  src={previewUrl}
                />
                <button
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors active:bg-black/80"
                  onClick={() => {
                    setUploadError(null);
                    setSelectedFile(null);
                  }}
                  type="button"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Retake
                </button>
              </>
            ) : cameraError ? (
              <button
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500 transition-transform active:scale-[0.99]"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-white">
                  <Camera className="h-7 w-7" />
                </span>
                <span className="text-sm font-medium">Tap to take photo</span>
              </button>
            ) : (
              <>
                <video
                  aria-label="Camera preview"
                  autoPlay
                  className="absolute inset-0 h-full w-full object-cover"
                  muted
                  onCanPlay={() => setIsCameraReady(true)}
                  playsInline
                  ref={videoRef}
                />
                <div className="pointer-events-none absolute inset-0 border-[3px] border-white/70" />
                {!isCameraReady ? (
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-white">
                    Starting camera...
                  </span>
                ) : null}
                <Button
                  className="absolute bottom-4 left-1/2 h-14 -translate-x-1/2 rounded-full px-6 text-base shadow-lg"
                  disabled={!isCameraReady || isSubmitting}
                  onClick={() => void handleCaptureFromCamera()}
                  type="button"
                >
                  <Camera className="h-5 w-5" />
                  Capture square photo
                </Button>
              </>
            )}
          </div>

          {uploadError ? (
            <p className="text-sm font-medium text-red-600">{uploadError}</p>
          ) : null}

          <div
            className={cn(
              "flex flex-col gap-1",
              isMobile && "sticky bottom-0 -mx-4 bg-slate-50 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2",
            )}
          >
            <Button
              className="h-14 w-full rounded-xl text-base"
              disabled={!selectedFile || isSubmitting}
              onClick={() => void handleSave(true)}
              size="lg"
              type="button"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Check className="h-5 w-5" />
              )}
              Save photo &amp; next part
            </Button>
            <Button
              className="h-11 w-full text-slate-500"
              disabled={isSubmitting}
              onClick={() => void handleSave(false)}
              type="button"
              variant="ghost"
            >
              Skip photo for this part
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <CheckCircle2 className="h-14 w-14 text-slate-950" />
          <div>
            <h3 className="text-xl font-semibold">Group complete</h3>
            <p className="mt-1 text-sm text-slate-500">
              Every assigned part has been captured or moved into processing.
            </p>
          </div>
          <Button asChild className="h-12 rounded-xl px-6" variant="outline">
            <Link onClick={() => triggerHaptic()} to="/groups">
              Back to groups
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
