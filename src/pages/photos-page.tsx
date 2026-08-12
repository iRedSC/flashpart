import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { Camera, ImageIcon, Loader2, Trash2 } from "lucide-react";
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
  const photos = useQuery(convexApi.galleryPhotos.list, {
    sessionToken: session.sessionToken,
  });
  const generateUploadUrl = useMutation(
    convexApi.productPhotos.generateUploadUrl,
  );
  const createFromUpload = useMutation(convexApi.galleryPhotos.createFromUpload);
  const deletePhoto = useMutation(convexApi.galleryPhotos.deletePhoto);
  const deleteUploadedStorage = useMutation(
    convexApi.productPhotos.deleteUploadedStorage,
  );

  const [isCapturing, setIsCapturing] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<Id<"productPhotos"> | null>(
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
      await createFromUpload({
        sessionToken: session.sessionToken,
        storageId,
      });
      triggerHaptic();
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

  async function handleDelete(photoId: Id<"productPhotos">) {
    if (deletingId) {
      return;
    }

    setDeletingId(photoId);
    setError(null);

    try {
      await deletePhoto({
        sessionToken: session.sessionToken,
        photoId,
      });
      triggerHaptic();
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

  const isLoading = photos === undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Photos</h2>
          <p className="mt-1 text-sm text-slate-500">
            Capture photos for later use.
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
              : photos.length === 0
                ? "No photos yet."
                : `${photos.length.toLocaleString()} photo${photos.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-slate-400">
              <ImageIcon className="h-10 w-10" />
              <p className="text-sm">Take a photo to get started.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((photo) => (
                <li
                  className="group relative aspect-square overflow-hidden rounded-md bg-slate-100"
                  key={photo._id}
                >
                  {photo.url ? (
                    <img
                      alt=""
                      className="h-full w-full object-cover"
                      src={photo.url}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                  <Button
                    aria-label="Delete photo"
                    className={cn(
                      "absolute right-2 top-2 h-8 w-8 bg-white/90 opacity-100 shadow-sm sm:opacity-0 sm:group-hover:opacity-100",
                      deletingId === photo._id && "opacity-100",
                    )}
                    disabled={deletingId === photo._id}
                    onClick={() => {
                      void handleDelete(photo._id);
                    }}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    {deletingId === photo._id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
