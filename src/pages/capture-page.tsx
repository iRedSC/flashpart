import * as React from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useAppData } from "../data/app-data-provider";
import type { Id } from "../../convex/_generated/dataModel";

export function CapturePage() {
  const { groupId } = useParams();
  const { groups, products, recordCapture } = useAppData();
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const typedGroupId = groupId as Id<"groups"> | undefined;
  const group = groups.find((item) => item._id === typedGroupId);
  const groupProducts = products.filter((product) => product.groupId === typedGroupId);
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

  async function handleCapture(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!typedGroupId || !nextProduct) {
      return;
    }

    setIsSubmitting(true);

    try {
      await recordCapture({
        groupId: typedGroupId,
        productId: nextProduct._id,
      });
      setSelectedFile(null);
      event.currentTarget.reset();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!group) {
    return (
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
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Badge variant="secondary">PWA capture flow</Badge>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">{group.name}</h2>
        <p className="text-slate-500">
          {completedCount.toLocaleString()} of {groupProducts.length.toLocaleString()} products captured or queued.
        </p>
      </div>

      {nextProduct ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{nextProduct.name}</CardTitle>
            <CardDescription>
              Get this part next, then take one clean product photo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
              <div className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">SKU</span>
                  <span className="font-mono font-medium">{nextProduct.sku}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Price</span>
                  <span>${nextProduct.price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Existing SKU behavior</span>
                  <span>
                    {nextProduct.duplicatePolicy === "blockExisting"
                      ? "Block"
                      : "Update"}
                  </span>
                </div>
              </div>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => void handleCapture(event).catch(() => undefined)}
            >
              <Input
                accept="image/*"
                capture="environment"
                onChange={(event) =>
                  setSelectedFile(event.currentTarget.files?.[0] ?? null)
                }
                type="file"
              />
              <Button className="w-full" disabled={isSubmitting} size="lg" type="submit">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                {selectedFile ? "Queue photo and get next part" : "Queue without upload stub"}
              </Button>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              Upload storage is stubbed for this slice; the Convex record and background job queue are wired.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6" />
              Group complete
            </CardTitle>
            <CardDescription>
              Every assigned product has been captured or moved into processing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/groups">Back to groups</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
