import { Archive, ArchiveRestore, FolderPlus, Send, Trash2 } from "lucide-react";
import {
  canPublishProduct,
  listOriginals,
  type ProductPhoto,
} from "../lib/product-photo";
import {
  canArchive,
  isArchived,
  isDuplicateSkuError,
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
  onDeletePhotos,
  onDeleteShopifyFile,
  onOpenPhoto,
  onPublish,
  onUnarchive,
  photos,
  product,
}: {
  onAddToGroup: () => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Multi-photo products: delete via deleteProductPhoto or open the photo dialog. */
  onDeletePhotos?: () => void;
  onDeleteShopifyFile: () => void;
  onOpenPhoto?: () => void;
  onPublish: () => void;
  onUnarchive: () => void;
  photos?: ProductPhoto[] | null;
  product: Product;
}) {
  const archived = isArchived(product);
  const archiveAllowed = canArchive(product);
  const photosLoading = photos === undefined;
  const canPublish =
    !photosLoading &&
    canPublishProduct(
      {
        aiImageStatus: product.aiImageStatus,
        aiShopifyFileId: product.aiShopifyFileId ?? undefined,
        needsPhotoReview: product.needsPhotoReview,
        pendingOperation: product.pendingOperation ?? undefined,
        phase: product.phase,
        shopifyFileId: product.shopifyFileId ?? undefined,
      },
      photos,
    );
  const hasPhotoRows = (photos?.length ?? 0) > 0;
  const originalCount = hasPhotoRows ? listOriginals(photos ?? []).length : 0;
  // Only treat as legacy once photos have resolved to an empty list.
  const isLegacyOnly =
    !photosLoading && !hasPhotoRows && Boolean(product.shopifyFileId);
  const publishOverwrite = isDuplicateSkuError(product);

  return (
    <>
      <DropdownMenuItem onSelect={onAddToGroup}>
        <FolderPlus />
        Add to group
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!canPublish || archived || photosLoading}
        onSelect={onPublish}
      >
        <Send />
        {publishOverwrite ? "Publish & overwrite" : "Publish"}
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
      {hasPhotoRows ? (
        <DropdownMenuItem
          onSelect={() => {
            if (onDeletePhotos) {
              onDeletePhotos();
              return;
            }

            onOpenPhoto?.();
          }}
        >
          <Trash2 />
          {originalCount > 1 ? "Delete photos…" : "Delete photo…"}
        </DropdownMenuItem>
      ) : null}
      {isLegacyOnly ? (
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
