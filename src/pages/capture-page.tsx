import * as React from "react";
import { useQuery } from "convex/react";
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useAppData } from "../data/app-data-provider";
import { zoomPermissionConstraint } from "../lib/camera-zoom";
import { canvasToFile, cropImageFileToSquare } from "../lib/capture-image";
import {
  getCaptureSelection,
  removeCaptureSelection,
} from "../lib/capture-selection";
import { convexApi } from "../lib/convex-api";
import {
  isGroupCaptureComplete,
  nextUncapturedGroupProduct,
  nextUncapturedSelectionProduct,
  selectionCaptureProgress,
} from "../lib/product-state";
import { triggerHaptic } from "../lib/haptics";
import { useCameraTrackZoom } from "../lib/use-camera-track-zoom";
import { useIsMobile } from "../lib/use-is-mobile";
import { ALLOW_CAMERA_PINCH_ATTR } from "../lib/use-prevent-pinch-zoom";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

const INLINE_CAMERA_UNAVAILABLE =
  "Inline camera is not available here. Use the camera picker instead.";

export function CapturePage() {
  const { groupId, selectionId } = useParams();
  const navigate = useNavigate();
  const { groups, products, settings, session, submitCapture } = useAppData();
  const isMobile = useIsMobile();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = React.useState<MediaStream | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [isCameraReady, setIsCameraReady] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  /** Keep capturing on this product until max photos or operator advances. */
  const [heldProductId, setHeldProductId] = React.useState<Id<"products"> | null>(
    null,
  );
  /** Optimistic original count while Convex query catches up after save. */
  const [localOriginalCount, setLocalOriginalCount] = React.useState(0);
  const previewUrl = React.useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : null),
    [selectedFile],
  );
  const { zoom, canZoom, cameraPlaneRef } = useCameraTrackZoom(cameraStream);
  const maxProductPhotos = settings?.maxProductPhotos ?? 5;

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
    setCameraStream(null);
    setIsCameraReady(false);

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const captureSelection = selectionId
    ? getCaptureSelection(selectionId)
    : null;
  const typedGroupId = groupId as Id<"groups"> | undefined;
  const group = captureSelection
    ? { name: captureSelection.label }
    : groups.find((item) => item._id === typedGroupId);
  const groupProducts = captureSelection
    ? products.filter(
        (product) =>
          captureSelection.productIds.includes(product._id) &&
          product.archivedAt === undefined,
      )
    : products.filter(
        (product) =>
          product.groupId === typedGroupId && product.archivedAt === undefined,
      );
  // nextUncaptured* treats a product as done once it has ≥1 original / phase≠imported.
  const nextUncaptured = captureSelection
    ? nextUncapturedSelectionProduct(products, captureSelection.productIds)
    : typedGroupId === undefined
      ? null
      : nextUncapturedGroupProduct(products, typedGroupId);
  const heldProduct = heldProductId
    ? (products.find(
        (product) =>
          product._id === heldProductId && product.archivedAt === undefined,
      ) ?? null)
    : null;
  const currentProduct = heldProduct ?? nextUncaptured;
  const { completedCount, total: selectionTotal } = captureSelection
    ? selectionCaptureProgress(products, captureSelection.productIds)
    : {
        completedCount: groupProducts.filter(isGroupCaptureComplete).length,
        total: groupProducts.length,
      };
  const progress =
    selectionTotal === 0
      ? 0
      : Math.round((completedCount / selectionTotal) * 100);
  const currentProductId = currentProduct?._id;

  const productPhotos = useQuery(
    convexApi.productPhotos.listByProduct,
    currentProductId
      ? { productId: currentProductId, sessionToken: session.sessionToken }
      : "skip",
  );
  const queryOriginalCount =
    productPhotos?.filter((photo) => photo.kind === "original").length ?? 0;
  const originalCount = Math.max(queryOriginalCount, localOriginalCount);
  const saveReachesMax = originalCount + 1 >= maxProductPhotos;

  React.useEffect(() => {
    if (!heldProductId) {
      return;
    }

    if (queryOriginalCount > localOriginalCount) {
      setLocalOriginalCount(queryOriginalCount);
    }
  }, [heldProductId, localOriginalCount, queryOriginalCount]);

  React.useEffect(() => {
    if (heldProductId && !heldProduct) {
      setHeldProductId(null);
      setLocalOriginalCount(0);
    }
  }, [heldProduct, heldProductId]);

  function clearHeldProduct() {
    setHeldProductId(null);
    setLocalOriginalCount(0);
  }

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
        const baseVideoConstraints = {
          aspectRatio: { ideal: 1 },
          facingMode: { ideal: "environment" },
          height: { ideal: 1600 },
          width: { ideal: 1600 },
        };
        const zoomConstraint = zoomPermissionConstraint();

        let stream: MediaStream;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              ...baseVideoConstraints,
              ...(zoomConstraint ?? {}),
            },
          });
        } catch (error) {
          // Retry without zoom if the UA rejects the PTZ permission constraint.
          if (!zoomConstraint) {
            throw error;
          }

          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: baseVideoConstraints,
          });
        }

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        setCameraStream(stream);

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

    if (currentProductId && !selectedFile) {
      void startCamera();
    } else {
      stopCamera();
    }

    return () => {
      isCancelled = true;
      stopCamera();
    };
  }, [currentProductId, selectedFile, stopCamera]);

  const containerClass = cn(
    "mx-auto flex w-full max-w-2xl flex-col",
    isMobile && "min-h-dvh px-4 pb-[env(safe-area-inset-bottom)]",
  );

  function resolveCaptureGroupId(product: (typeof products)[number]) {
    if (captureSelection) {
      return product.groupId ?? captureSelection.captureGroupId;
    }

    return typedGroupId;
  }

  async function handleSave(withPhoto: boolean) {
    if (!currentProduct || isSaving) {
      return;
    }

    const captureGroupId = resolveCaptureGroupId(currentProduct);

    if (!captureGroupId) {
      return;
    }

    if (withPhoto && !selectedFile) {
      return;
    }

    const capturedProductId = currentProduct._id;
    const fileToUpload = withPhoto ? selectedFile : undefined;
    const countBeforeSave = originalCount;

    triggerHaptic();
    setUploadError(null);
    setSelectedFile(null);
    setIsSaving(true);

    try {
      await submitCapture({
        groupId: captureGroupId,
        productId: capturedProductId,
        file: fileToUpload ?? undefined,
      });

      if (withPhoto) {
        const nextCount = countBeforeSave + 1;

        if (nextCount < maxProductPhotos) {
          setHeldProductId(capturedProductId);
          setLocalOriginalCount(nextCount);
        } else {
          clearHeldProduct();
        }
      } else {
        clearHeldProduct();
      }

      triggerHaptic();
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Photo could not be saved. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleNextProduct() {
    triggerHaptic();
    setUploadError(null);
    setSelectedFile(null);
    clearHeldProduct();
  }

  async function handleCaptureFromCamera() {
    const video = videoRef.current;

    if (
      !currentProduct ||
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
      const file = await canvasToFile(
        canvas,
        `${currentProduct.sku}-capture.jpg`,
      );
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

  React.useEffect(() => {
    if (!selectionId || captureSelection) {
      return;
    }

    navigate("/products", { replace: true });
  }, [captureSelection, navigate, selectionId]);

  if (!group) {
    const backTo = captureSelection || selectionId ? "/products" : "/groups";
    const title = selectionId ? "Selection not found" : "Group not found";

    return (
      <div className={cn(containerClass, isMobile && "pt-[calc(env(safe-area-inset-top)+1rem)]")}>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to={backTo}>Back</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const saveLabel = saveReachesMax ? "Save photo & next part" : "Save photo";
  const secondaryIsNext = originalCount > 0;

  return (
    <div className={containerClass}>
      <header
        className={cn(
          "flex items-center gap-1 pb-2",
          isMobile ? "pt-[calc(env(safe-area-inset-top)+0.5rem)]" : "pt-0",
        )}
      >
        <Link
          aria-label={captureSelection ? "Back to products" : "Back to groups"}
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors active:bg-slate-200"
          onClick={() => triggerHaptic()}
          to={captureSelection ? "/products" : "/groups"}
        >
          <ChevronLeft className="h-6 w-6" />
        </Link>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {group.name}
        </h2>
        <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold tabular-nums text-slate-700">
          {completedCount}/{selectionTotal}
        </span>
      </header>

      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-950 transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {currentProduct ? (
        <div className="flex flex-1 flex-col gap-4 pt-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {originalCount > 0 ? "Current part" : "Next part"}
              </p>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-700">
                {originalCount}/{maxProductPhotos} photos
              </span>
            </div>
            <h3 className="mt-1 text-lg font-semibold leading-snug">
              {currentProduct.name}
            </h3>
            <div className="mt-3 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">SKU</p>
                <p className="select-text truncate font-mono text-xl font-semibold tabular-nums">
                  {currentProduct.sku}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Price</p>
                <p className="text-xl font-semibold tabular-nums">
                  ${currentProduct.price.toFixed(2)}
                </p>
              </div>
            </div>
            {settings?.duplicatePolicy === "blockExisting" ? (
              <p className="mt-2 text-xs text-slate-500">
                Existing SKUs are blocked in Shopify.
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
              key={`${currentProduct._id}-${originalCount}`}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            {previewUrl ? (
              <>
                <img
                  alt={`Captured photo for ${currentProduct.sku}`}
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
                <div
                  ref={cameraPlaneRef}
                  {...(canZoom
                    ? { [ALLOW_CAMERA_PINCH_ATTR]: "" }
                    : undefined)}
                  className={cn("absolute inset-0", canZoom && "touch-none")}
                >
                  <video
                    aria-label={
                      canZoom
                        ? "Camera preview. Pinch to zoom."
                        : "Camera preview"
                    }
                    autoPlay
                    className="absolute inset-0 h-full w-full object-cover"
                    muted
                    onCanPlay={() => setIsCameraReady(true)}
                    playsInline
                    ref={videoRef}
                  />
                </div>
                <div className="pointer-events-none absolute inset-0 border-[3px] border-white/70" />
                {!isCameraReady ? (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium text-white">
                    Starting camera...
                  </span>
                ) : null}
                {canZoom && isCameraReady ? (
                  <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur">
                    {zoom.toFixed(1)}x
                  </span>
                ) : null}
                {originalCount > 0 ? (
                  <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur">
                    {originalCount}/{maxProductPhotos}
                  </span>
                ) : null}
                <Button
                  aria-label="Capture photo"
                  className="absolute bottom-4 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full p-0 shadow-lg"
                  disabled={!isCameraReady || isSaving}
                  onClick={() => void handleCaptureFromCamera()}
                  type="button"
                >
                  <Camera className="h-7 w-7" />
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
              disabled={!selectedFile || isSaving}
              onClick={() => void handleSave(true)}
              size="lg"
              type="button"
            >
              <Check className="h-5 w-5" />
              {saveLabel}
            </Button>
            {secondaryIsNext ? (
              <Button
                className="h-11 w-full text-slate-500"
                disabled={isSaving}
                onClick={handleNextProduct}
                type="button"
                variant="ghost"
              >
                Next product
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                className="h-11 w-full text-slate-500"
                disabled={isSaving}
                onClick={() => void handleSave(false)}
                type="button"
                variant="ghost"
              >
                Skip photo for this part
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <CheckCircle2 className="h-14 w-14 text-slate-950" />
          <div>
            <h3 className="text-xl font-semibold">Group complete</h3>
          </div>
          <Button asChild className="h-12 rounded-xl px-6" variant="outline">
            <Link
              onClick={() => {
                if (selectionId) {
                  removeCaptureSelection(selectionId);
                }

                triggerHaptic();
              }}
              to={captureSelection ? "/products" : "/groups"}
            >
              {captureSelection ? "Back to products" : "Back to groups"}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
