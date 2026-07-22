import * as React from "react";
import { useConvex } from "convex/react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { convexApi } from "../lib/convex-api";
import {
  buildExportImagePlan,
  buildExportPhotosZip,
  downloadBlob,
  type ExportProduct,
} from "../lib/export-photos";
import type { ProductPhoto } from "../lib/product-photo";
import type { Id } from "../../convex/_generated/dataModel";

type ExportPhotosDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ExportProduct[];
  /** Fallback photos if the fresh export query fails. */
  photosByProductId: Record<string, ProductPhoto[]>;
  sessionToken: string;
};

export function ExportPhotosDialog({
  open,
  onOpenChange,
  products,
  photosByProductId,
  sessionToken,
}: ExportPhotosDialogProps) {
  const convex = useConvex();
  const [removePrefix, setRemovePrefix] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function resetState() {
    setRemovePrefix(false);
    setIsExporting(false);
    setProgress(null);
    setError(null);
  }

  async function handleExport() {
    if (products.length === 0 || isExporting) {
      return;
    }

    setIsExporting(true);
    setError(null);
    setProgress(null);

    try {
      const productIds = products.map(
        (product) => product._id as Id<"products">,
      );

      let exportPhotosByProductId = photosByProductId;
      try {
        const fresh = await convex.query(
          convexApi.productPhotos.listExportPhotosForProducts,
          {
            productIds,
            sessionToken,
          },
        );
        const map: Record<string, ProductPhoto[]> = {};
        for (const [productId, photos] of Object.entries(fresh)) {
          map[productId] = photos as ProductPhoto[];
        }
        exportPhotosByProductId = map;
      } catch {
        // Fall back to the already-loaded product-list photo map.
      }

      const plan = buildExportImagePlan({
        products,
        photosByProductId: exportPhotosByProductId,
        removePrefix,
      });

      if (plan.length === 0) {
        setError("No exportable photos found for the selected products.");
        return;
      }

      const { blob, addedCount } = await buildExportPhotosZip(plan, {
        onProgress: (done, total) => setProgress({ done, total }),
      });

      if (addedCount === 0) {
        setError("Could not download any photo files. Try again.");
        return;
      }

      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `flashpart-photos-${stamp}.zip`);
      resetState();
      onOpenChange(false);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Export failed. Try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (isExporting) {
          return;
        }
        onOpenChange(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
      open={open}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export photos</DialogTitle>
          <DialogDescription>
            Download a ZIP of original and AI photos for{" "}
            {products.length.toLocaleString()} selected product
            {products.length === 1 ? "" : "s"}. Missing photos are skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="export-remove-prefix"
              >
                Remove prefix
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Strip everything through the first dash before grouping and
                naming folders.
              </p>
            </div>
            <Checkbox
              checked={removePrefix}
              disabled={isExporting}
              id="export-remove-prefix"
              onCheckedChange={(checked) => setRemovePrefix(checked === true)}
            />
          </div>

          {isExporting ? (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <div>
                <p className="font-medium text-slate-950">Building ZIP…</p>
                <p className="mt-1">
                  {progress
                    ? `Fetched ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} files`
                    : "Preparing photo list…"}
                </p>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            disabled={isExporting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={isExporting || products.length === 0}
            onClick={() => void handleExport()}
            type="button"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
