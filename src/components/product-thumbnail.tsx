import { AlertCircle, Camera, Loader2 } from "lucide-react";
import {
  getProductThumbnailUrl,
  isAiImageFailed,
  isAiImageGenerating,
  type ProductPhoto,
} from "../lib/product-photo";
import { cn } from "../lib/utils";

type ProductThumbnailProduct = {
  aiImageStatus?: "pending" | "generating" | "ready" | "failed";
  aiShopifyFileUrl?: string;
  shopifyFileUrl?: string;
  sku: string;
};

export function ProductThumbnail({
  className,
  onClick,
  photoCount,
  photos,
  product,
}: {
  className?: string;
  onClick?: () => void;
  /** When > 1, shows a small count badge on the thumb. */
  photoCount?: number;
  photos?: ProductPhoto[] | null;
  product: ProductThumbnailProduct;
}) {
  const thumbnailUrl = getProductThumbnailUrl(product, photos);
  const generating = isAiImageGenerating(product, photos);
  const failed = isAiImageFailed(product, photos);
  const showCount = photoCount != null && photoCount > 1;
  const sharedClassName = cn(
    "relative shrink-0 overflow-hidden rounded-lg bg-slate-100",
    className,
  );

  const countBadge = showCount ? (
    <span className="absolute bottom-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded bg-slate-950/80 px-1 text-[10px] font-medium leading-none text-white">
      {photoCount}
    </span>
  ) : null;

  if (thumbnailUrl) {
    const content = (
      <>
        <img
          alt={`Photo for ${product.sku}`}
          className="h-full w-full object-cover"
          src={thumbnailUrl}
        />
        {generating ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/35">
            <Loader2 className="h-4 w-4 animate-spin text-white" />
          </span>
        ) : null}
        {failed ? (
          <span className="absolute bottom-1 left-1 rounded-full bg-red-600 p-1 text-white">
            <AlertCircle className="h-3 w-3" />
          </span>
        ) : null}
        {countBadge}
      </>
    );

    if (onClick) {
      return (
        <button
          aria-label={`View photo for ${product.sku}`}
          className={cn(sharedClassName, "transition-transform active:scale-95")}
          onClick={onClick}
          type="button"
        >
          {content}
        </button>
      );
    }

    return <div className={sharedClassName}>{content}</div>;
  }

  if (generating) {
    const content = (
      <>
        <span className="flex h-full w-full items-center justify-center text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
        {countBadge}
      </>
    );

    if (onClick) {
      return (
        <button
          aria-label={`View photo for ${product.sku}`}
          className={cn(sharedClassName, "transition-transform active:scale-95")}
          onClick={onClick}
          type="button"
        >
          {content}
        </button>
      );
    }

    return <div className={sharedClassName}>{content}</div>;
  }

  const placeholder = (
    <>
      <span className="flex h-full w-full items-center justify-center text-slate-400">
        {failed ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </span>
      {countBadge}
    </>
  );

  if (onClick) {
    return (
      <button
        aria-label={`View photo for ${product.sku}`}
        className={cn(sharedClassName, "transition-transform active:scale-95")}
        onClick={onClick}
        type="button"
      >
        {placeholder}
      </button>
    );
  }

  return <div className={sharedClassName}>{placeholder}</div>;
}
