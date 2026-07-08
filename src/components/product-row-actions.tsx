import { FolderPlus, Send, Trash2 } from "lucide-react";
import { isPublishable } from "../lib/product-state";
import { DropdownMenuItem } from "./ui/dropdown-menu";

type Product = {
  _id: string;
  aiImageStatus?: "pending" | "generating" | "ready" | "failed";
  aiShopifyFileId?: string | null;
  needsPhotoReview?: boolean;
  pendingOperation?: string | null;
  phase: "imported" | "captured" | "published";
  shopifyFileId?: string | null;
  shopifyStatus?: string | null;
  sku: string;
};

export function ProductRowActionItems({
  onAddToGroup,
  onDelete,
  onDeleteShopifyFile,
  onPublish,
  product,
}: {
  onAddToGroup: () => void;
  onDelete: () => void;
  onDeleteShopifyFile: () => void;
  onPublish: () => void;
  product: Product;
}) {
  const canPublish = isPublishable({
    aiImageStatus: product.aiImageStatus,
    aiShopifyFileId: product.aiShopifyFileId ?? undefined,
    needsPhotoReview: product.needsPhotoReview,
    pendingOperation: product.pendingOperation as
      | "captureProcessing"
      | "aiImageGenerating"
      | "publishing"
      | undefined,
    phase: product.phase,
    shopifyFileId: product.shopifyFileId ?? undefined,
  });

  return (
    <>
      <DropdownMenuItem onSelect={onAddToGroup}>
        <FolderPlus />
        Add to group
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canPublish} onSelect={onPublish}>
        <Send />
        Publish
      </DropdownMenuItem>
      {product.shopifyFileId ? (
        <DropdownMenuItem onSelect={onDeleteShopifyFile}>
          <Trash2 />
          Delete Shopify photo
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        className="text-red-600 focus:bg-red-50 focus:text-red-600"
        onSelect={onDelete}
      >
        <Trash2 />
        Delete
      </DropdownMenuItem>
    </>
  );
}
