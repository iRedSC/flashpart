import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Camera, ImageIcon, Loader2, Sparkles, Trash2 } from "lucide-react";
import { GalleryPhotoDialog } from "../components/gallery-photo-dialog";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { useAppData } from "../data/app-data-provider";
import { cropImageFileToSquare } from "../lib/capture-image";
import { convexApi } from "../lib/convex-api";
import { triggerHaptic } from "../lib/haptics";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

export function PhotosPage() {
  const { session } = useAppData();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const pairs = useQuery(convexApi.galleryPhotos.listPairs, {
    sessionToken: session.sessionToken,
  });
  const generateUploadUrl = useMutation(
    convexApi.productPhotos.generateUploadUrl,
  );
  const createFromUpload = useMutation(convexApi.galleryPhotos.createFromUpload);
  const deletePhoto = useMutation(convexApi.galleryPhotos.deletePhoto);
  const deleteShopifyPhoto = useAction(
    convexApi.shopify.removeGalleryPhotoFromShopify,
  );
  const deleteUploadedStorage = useMutation(
    convexApi.productPhotos.deleteUploadedStorage,
  );

  const [isCapturing, setIsCapturing] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<Id<"productPhotos"> | null>(
    null,
  );
  const [editingId, setEditingId] = React.useState<Id<"productPhotos"> | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const capturingRef = React.useRef(false);

  async function uploadGalleryFile(file: File) {
    if (capturingRef.current) {
      return;
    }

    capturingRef.current = true;
    setIsCapturing(true);
    setError(null);
    let storageId: Id<"_storage"> | null = null;

    try {
      const square = await cropImageFileToSquare(file);
      const uploadUrl = await generateUploadUrl({
        sessionToken: session.sessionToken,
      });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": square.type || "image/jpeg",
        },
        body: square,
      });

      if (!response.ok) {
        throw new Error("Photo upload failed. Check your connection and retry.");
      }

      const result = (await response.json()) as { storageId?: string };
      if (!result.storageId) {
        throw new Error("Photo upload failed. Missing storage id.");
      }

      storageId = result.storageId as Id<"_storage">;
      const originalPhotoId = await createFromUpload({
        sessionToken: session.sessionToken,
        storageId,
      });
      triggerHaptic();
      setEditingId(originalPhotoId);
    } catch (uploadError) {
      if (storageId) {
        try {
          await deleteUploadedStorage({
            sessionToken: session.sessionToken,
            storageId,
          });
        } catch {
          // Best-effort orphan cleanup.
        }
      }

      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not save the photo.",
      );
    } finally {
      capturingRef.current = false;
      setIsCapturing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleDelete(originalPhotoId: Id<"productPhotos">, aiPhotoId?: Id<"productPhotos">) {
    if (deletingId) {
      return;
    }

    setDeletingId(originalPhotoId);
    setError(null);

    try {
      if (aiPhotoId) {
        try {
          await deleteShopifyPhoto({
            sessionToken: session.sessionToken,
            photoId: aiPhotoId,
          });
        } catch {
          // May not be on Shopify; continue with Convex delete.
        }
      }

      await deletePhoto({
        sessionToken: session.sessionToken,
        photoId: originalPhotoId,
      });
      triggerHaptic();
      if (editingId === originalPhotoId) {
        setEditingId(null);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the photo.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  const isLoading = pairs === undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Photos</h2>
          <p className="mt-1 text-sm text-slate-500">
            Capture, edit with AI, and upload to Shopify.
          </p>
        </div>
        <Button
          disabled={isCapturing}
          onClick={() => {
            triggerHaptic();
            fileInputRef.current?.click();
          }}
          type="button"
        >
          {isCapturing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {isCapturing ? "Saving…" : "Capture"}
        </Button>
        <input
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void uploadGalleryFile(file);
            }
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0">
          <CardTitle className="text-base">Gallery</CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading…"
              : pairs.length === 0
                ? "No photos yet."
                : `${pairs.length.toLocaleString()} photo${pairs.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : pairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
              <ImageIcon className="h-10 w-10" />
              <p className="text-sm">Take a photo to get started.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {pairs.map(({ original, ai }) => {
                const thumbUrl = ai?.url ?? original.url;
                const generating =
                  ai?.aiStatus === "generating" ||
                  ai?.aiStatus === "pending" ||
                  ai?.status === "uploading";
                const onShopify =
                  ai?.shopifyFileStatus === "ready" ||
                  ai?.status === "promoted";
                const needsReview =
                  ai?.aiStatus === "ready" &&
                  ai.approvedAt == null &&
                  !onShopify;

                return (
                  <li
                    className="group relative aspect-square overflow-hidden rounded-md bg-slate-100"
                    key={original._id}
                  >
                    <button
                      className="h-full w-full"
                      onClick={() => {
                        triggerHaptic();
                        setEditingId(original._id);
                      }}
                      type="button"
                    >
                      {thumbUrl ? (
                        <img
                          alt=""
                          className="h-full w-full object-cover"
                          src={thumbUrl}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-slate-400">
                          {generating ? (
                            <Loader2 className="h-6 w-6 animate-spin" />
                          ) : (
                            <ImageIcon className="h-6 w-6" />
                          )}
                        </div>
                      )}
                    </button>

                    {generating ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-950/70 px-2 py-1 text-center text-[10px] text-white">
                        Editing…
                      </div>
                    ) : null}

                    {onShopify ? (
                      <div className="pointer-events-none absolute left-2 top-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Shopify
                      </div>
                    ) : needsReview ? (
                      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        <Sparkles className="h-3 w-3" />
                        Review
                      </div>
                    ) : null}

                    <Button
                      aria-label="Delete photo"
                      className={cn(
                        "absolute right-2 top-2 h-8 w-8 bg-white/90 opacity-100 shadow-sm sm:opacity-0 sm:group-hover:opacity-100",
                        deletingId === original._id && "opacity-100",
                      )}
                      disabled={deletingId === original._id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(original._id, ai?._id);
                      }}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      {deletingId === original._id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <GalleryPhotoDialog
        onOpenChange={(open) => {
          if (!open) {
            setEditingId(null);
          }
        }}
        open={editingId != null}
        originalPhotoId={editingId}
      />
    </div>
  );
}
