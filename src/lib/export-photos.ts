import JSZip from "jszip";
import { buildPhotoPairs, type ProductPhoto } from "./product-photo";

export type ExportProduct = {
  _id: string;
  sku: string;
  shopifyFileUrl?: string;
  aiShopifyFileUrl?: string;
};

export type ExportImagePlan = {
  /** Path inside the zip without extension, e.g. GROUP/SKU/SKU_1_ORIGINAL */
  pathWithoutExt: string;
  url: string;
};

/** Strip everything through the first `-` (import-style prefix). */
export function stripSkuPrefix(sku: string): string {
  const index = sku.indexOf("-");
  return index === -1 ? sku : sku.slice(index + 1);
}

/** Group key = text before the last `-`; whole SKU if none. */
export function skuGroupKey(sku: string): string {
  const index = sku.lastIndexOf("-");
  return index === -1 ? sku : sku.slice(0, index);
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned || "unnamed";
}

function photoHasExportableUrl(photo: {
  url?: string;
  status: ProductPhoto["status"];
}): photo is { url: string; status: ProductPhoto["status"] } {
  return (
    Boolean(photo.url) &&
    photo.status !== "uploading" &&
    photo.status !== "failed"
  );
}

/**
 * Build the list of image URLs to pack. Missing originals/AI are omitted.
 * Photo index is 1-based in pair display order (SKU_1, SKU_2, …).
 */
export function buildExportImagePlan(args: {
  products: ExportProduct[];
  photosByProductId: Record<string, ProductPhoto[]>;
  removePrefix: boolean;
}): ExportImagePlan[] {
  const images: ExportImagePlan[] = [];

  for (const product of args.products) {
    const workingSku = args.removePrefix
      ? stripSkuPrefix(product.sku)
      : product.sku;
    const group = sanitizePathSegment(skuGroupKey(workingSku));
    const skuFolder = sanitizePathSegment(workingSku);
    const fileSku = sanitizePathSegment(workingSku);
    const photos = args.photosByProductId[product._id] ?? [];

    if (photos.length > 0) {
      const pairs = buildPhotoPairs(photos);
      pairs.forEach((pair, index) => {
        const n = index + 1;
        const basePath = `${group}/${skuFolder}/${fileSku}_${n}`;

        if (photoHasExportableUrl(pair.original)) {
          images.push({
            pathWithoutExt: `${basePath}_ORIGINAL`,
            url: pair.original.url,
          });
        }

        if (pair.ai && photoHasExportableUrl(pair.ai)) {
          images.push({
            pathWithoutExt: basePath,
            url: pair.ai.url,
          });
        }
      });
      continue;
    }

    // Legacy product-level Shopify URLs (no productPhotos rows).
    if (product.shopifyFileUrl) {
      images.push({
        pathWithoutExt: `${group}/${skuFolder}/${fileSku}_1_ORIGINAL`,
        url: product.shopifyFileUrl,
      });
    }
    if (product.aiShopifyFileUrl) {
      images.push({
        pathWithoutExt: `${group}/${skuFolder}/${fileSku}_1`,
        url: product.aiShopifyFileUrl,
      });
    }
  }

  return images;
}

export function extensionFromBlobAndUrl(blob: Blob, url: string): string {
  const type = (blob.type || "").toLowerCase();
  if (type.includes("png")) {
    return "png";
  }
  if (type.includes("webp")) {
    return "webp";
  }
  if (type.includes("gif")) {
    return "gif";
  }
  if (type.includes("jpeg") || type.includes("jpg")) {
    return "jpg";
  }

  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch {
    // ignore invalid URLs
  }

  return "jpg";
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export type BuildExportZipResult = {
  blob: Blob;
  addedCount: number;
  skippedCount: number;
};

/** Fetch planned images and pack into a ZIP. Failed fetches are skipped. */
export async function buildExportPhotosZip(
  plan: ExportImagePlan[],
  options?: { concurrency?: number; onProgress?: (done: number, total: number) => void },
): Promise<BuildExportZipResult> {
  const zip = new JSZip();
  let addedCount = 0;
  let skippedCount = 0;
  let done = 0;
  const total = plan.length;
  const concurrency = options?.concurrency ?? 6;

  if (total === 0) {
    return { blob: await zip.generateAsync({ type: "blob" }), addedCount: 0, skippedCount: 0 };
  }

  await mapPool(plan, concurrency, async (entry) => {
    try {
      const response = await fetch(entry.url, { credentials: "omit" });
      if (!response.ok) {
        skippedCount += 1;
        return;
      }
      const blob = await response.blob();
      if (blob.size === 0) {
        skippedCount += 1;
        return;
      }
      const ext = extensionFromBlobAndUrl(blob, entry.url);
      zip.file(`${entry.pathWithoutExt}.${ext}`, blob);
      addedCount += 1;
    } catch {
      skippedCount += 1;
    } finally {
      done += 1;
      options?.onProgress?.(done, total);
    }
  });

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, addedCount, skippedCount };
}

export function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
