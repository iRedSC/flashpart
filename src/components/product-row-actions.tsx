import { Archive, ArchiveRestore, FolderPlus, Send, Trash2 } from "lucide-react";
import {
  canArchive,
  isArchived,
  isPublishable,
  type LastError,
} from "../lib/product-state";
import { DropdownMenuItem } from "./ui/dropdown-menu";

type Product = {
  _id: string;
  aiImageStatus?: "pending" | "generating" | "ready" | "failed";
  aiShopifyFileId?: string | null;
  archivedAt?: number;
  lastError?: LastError;
  needsPhotoReview?: boolean;
  pendingOperation?: string | null;
  phase: "imported" | "captured" | "published";
  shopifyFileId?: string | null;
  shopifyStatus?: string | null;
  sku: string;
};

export function ProductRowActionItems({
  onAddToGroup,
  onArchive,
  onDelete,
  onDeleteShopifyFile,
  onPublish,
  onUnarchive,
  product,
}: {
  onAddToGroup: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDeleteShopifyFile: () => void;
  onPublish: () => void;
  onUnarchive: () => void;
  product: Product;
}) {
  const archived = isArchived(product);
  const archiveAllowed = canArchive(product);
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
      <DropdownMenuItem disabled={!canPublish || archived} onSelect={onPublish}>
        <Send />
        Publish
      </DropdownMenuItem>
      {archived ? (
        <DropdownMenuItem onSelect={onUnarchive}>
          <ArchiveRestore />
          Unarchive
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={!archiveAllowed}
          onSelect={onArchive}
          title={
            archiveAllowed
              ? undefined
              : "Resolve the error before archiving this product"
          }
        >
          <Archive />
          Archive
        </DropdownMenuItem>
      )}
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
