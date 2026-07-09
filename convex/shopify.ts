import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  httpAction,
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireSessionUser } from "./authUtils";
import {
  createShopifyFile,
  createStagedImageUpload,
  deleteShopifyFiles,
  getShopifyFile,
  pollShopifyFileUntilReady,
  removeFileReferenceFromProduct,
  uploadImageBufferToShopify,
} from "./shopifyClient";

const SHOPIFY_SCOPES = ["read_products", "write_products", "read_files", "write_files"];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type ShopifyAccessTokenResponse = {
  access_token?: string;
  scope?: string;
};

type ShopifyConnection = {
  accessToken: string;
  shopDomain: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shopifyModel = {
  createOAuthState: makeFunctionReference(
    "shopifyModel.js:createOAuthState",
  ) as any,
  storeConnectionFromOAuth: makeFunctionReference(
    "shopifyModel.js:storeConnectionFromOAuth",
  ) as any,
  currentActiveConnection: makeFunctionReference(
    "shopifyModel.js:currentActiveConnection",
  ) as any,
  firstActiveConnection: makeFunctionReference(
    "shopifyModel.js:firstActiveConnection",
  ) as any,
  getConnectionById: makeFunctionReference(
    "shopify.js:getConnectionById",
  ) as any,
  getShopifyProductIdForPhoto: makeFunctionReference(
    "shopify.js:getShopifyProductIdForPhoto",
  ) as any,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const productModel = {
  getFileForDeletion: makeFunctionReference(
    "products.js:getFileForDeletion",
  ) as any,
  markShopifyFileDeleted: makeFunctionReference(
    "products.js:markShopifyFileDeleted",
  ) as any,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const productPhotosModel = {
  getPhotoForPromote: makeFunctionReference(
    "productPhotos.js:getPhotoForPromote",
  ) as any,
  getPhotoForDeletion: makeFunctionReference(
    "productPhotos.js:getPhotoForDeletion",
  ) as any,
  markPromotedInternal: makeFunctionReference(
    "productPhotos.js:markPromotedInternal",
  ) as any,
  markPromoteFailedInternal: makeFunctionReference(
    "productPhotos.js:markPromoteFailedInternal",
  ) as any,
  clearStorageIdInternal: makeFunctionReference(
    "productPhotos.js:clearStorageIdInternal",
  ) as any,
  deletePhotoInternal: makeFunctionReference(
    "productPhotos.js:deletePhotoInternal",
  ) as any,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photoGcModel = {
  gcPromotedStorage: makeFunctionReference(
    "photoGc.js:gcPromotedStorage",
  ) as any,
};

const normalizeShopDomain = (value: string) => {
  const domain = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

  if (!domain) {
    throw new ConvexError("Enter a Shopify store domain.");
  }

  return domain.endsWith(".myshopify.com")
    ? domain
    : `${domain.replace(/\.myshopify\.com$/, "")}.myshopify.com`;
};

const assertShopifyEnv = () => {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new ConvexError(
      "Missing Shopify Convex env vars: SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.",
    );
  }

  return { clientId, clientSecret };
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return result === 0;
};

const verifyShopifyHmac = async (url: URL, clientSecret: string) => {
  const hmac = url.searchParams.get("hmac");

  if (!hmac) {
    return false;
  }

  const message = Array.from(url.searchParams.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );

  return constantTimeEqual(toHex(signature), hmac);
};

const htmlResponse = (title: string, message: string, status = 200) =>
  new Response(
    `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`,
    {
      headers: { "content-type": "text/html; charset=utf-8" },
      status,
    },
  );

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function confirmUrlFetchable(url: string) {
  try {
    const head = await fetch(url, { method: "HEAD" });

    if (head.ok) {
      return;
    }
  } catch {
    // Fall through to GET.
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new ConvexError("Shopify file URL is not fetchable yet.");
  }
}

async function schedulePromotedStorageGc(ctx: ActionCtx) {
  // Light orphan sweep after successful promote (promote already clears the
  // current photo; GC is a safety net for leftover storageId on other rows).
  await ctx.scheduler.runAfter(0, photoGcModel.gcPromotedStorage, {
    limit: 25,
  });
}

type PromotePhotoRow = {
  _id: Id<"productPhotos">;
  kind: "original" | "ai";
  storageId?: Id<"_storage">;
  shopifyFileId?: string;
  shopifyFileStatus?: "uploaded" | "processing" | "ready" | "failed";
  status: "uploading" | "ready" | "failed" | "promoted";
  url?: string;
  sortOrder: number;
  approvedAt?: number;
  aiStatus?: "pending" | "generating" | "ready" | "failed";
  aiGeneration?: number;
};

function assertPhotoEligibleForPromote(
  photo: PromotePhotoRow,
  options: { requireApprovedAi: boolean },
) {
  if (photo.kind !== "ai") {
    throw new ConvexError("Only AI photos can be promoted to Shopify.");
  }

  if (photo.aiStatus !== "ready") {
    throw new ConvexError(
      options.requireApprovedAi
        ? "Wait for the AI photo to finish generating before promoting."
        : "AI photo is no longer ready for publish.",
    );
  }

  if (photo.approvedAt == null) {
    throw new ConvexError(
      options.requireApprovedAi
        ? "Approve the AI photo before promoting."
        : "AI photo is no longer approved for publish.",
    );
  }
}

/**
 * Re-load the photo and re-assert promote eligibility immediately before
 * markPromoted so a concurrent regen cannot leave a stale Shopify file stamped.
 */
async function assertStillEligibleForMarkPromoted(
  ctx: ActionCtx,
  photoId: Id<"productPhotos">,
  options: {
    requireApprovedAi: boolean;
    expectedAiGeneration?: number;
  },
) {
  const payload = (await ctx.runQuery(productPhotosModel.getPhotoForPromote, {
    photoId,
  })) as {
    photo: PromotePhotoRow;
    sku: string;
  } | null;

  if (!payload?.photo) {
    throw new ConvexError("Photo not found.");
  }

  assertPhotoEligibleForPromote(payload.photo, options);

  if (
    options.expectedAiGeneration !== undefined &&
    (payload.photo.aiGeneration ?? 0) !== options.expectedAiGeneration
  ) {
    throw new ConvexError(
      "AI photo was regenerated during promote; aborting stale promote.",
    );
  }

  return payload.photo;
}

async function markPromoteFailedIfShopifyTerminal(
  ctx: ActionCtx,
  connection: ShopifyConnection,
  photoId: Id<"productPhotos">,
  shopifyFileId: string,
) {
  try {
    const file = await getShopifyFile(connection, shopifyFileId);
    if (file.status !== "failed") {
      return;
    }

    await ctx.runMutation(productPhotosModel.markPromoteFailedInternal, {
      photoId,
      shopifyFileId: file.id,
      shopifyFileStatus: "failed",
      shopifyFileUrl: file.url,
    });
  } catch {
    // Best-effort; promote error still propagates to the caller.
  }
}

async function finishPromoteFromShopifyFile(
  ctx: ActionCtx,
  connection: ShopifyConnection,
  photoId: Id<"productPhotos">,
  shopifyFileId: string,
  photo: PromotePhotoRow,
  options: { requireApprovedAi: boolean; expectedAiGeneration?: number },
) {
  let file = {
    id: shopifyFileId,
    status: photo.shopifyFileStatus ?? ("processing" as const),
    url: photo.url,
  };

  try {
    if (file.status !== "ready" || !file.url) {
      file = await pollShopifyFileUntilReady(connection, shopifyFileId);
    }

    if (file.url) {
      await confirmUrlFetchable(file.url);
    }
  } catch (error) {
    await markPromoteFailedIfShopifyTerminal(
      ctx,
      connection,
      photoId,
      shopifyFileId,
    );
    throw error;
  }

  await assertStillEligibleForMarkPromoted(ctx, photoId, options);

  await ctx.runMutation(productPhotosModel.markPromotedInternal, {
    photoId,
    shopifyFileId: file.id,
    shopifyFileStatus: file.status,
    shopifyFileUrl: file.url,
    keepStorageId: true,
    expectedAiGeneration: options.expectedAiGeneration,
    markAsPromoted: true,
  });

  // Only clear the storage blob this promote started with — never a regen's.
  if (photo.storageId) {
    await ctx.runMutation(productPhotosModel.clearStorageIdInternal, {
      photoId,
      expectedStorageId: photo.storageId,
      expectedAiGeneration: options.expectedAiGeneration,
    });
  }

  await schedulePromotedStorageGc(ctx);

  return {
    shopifyFileId: file.id,
    url: file.url,
    status: file.status,
  };
}

async function promotePhotoWithConnection(
  ctx: ActionCtx,
  connection: ShopifyConnection,
  photoId: Id<"productPhotos">,
  options: { requireApprovedAi: boolean },
) {
  const payload = (await ctx.runQuery(productPhotosModel.getPhotoForPromote, {
    photoId,
  })) as {
    photo: PromotePhotoRow;
    sku: string;
  } | null;

  if (!payload?.photo) {
    throw new ConvexError("Photo not found.");
  }

  const { photo, sku } = payload;
  assertPhotoEligibleForPromote(photo, options);
  const expectedAiGeneration = photo.aiGeneration;
  const markOptions = {
    requireApprovedAi: options.requireApprovedAi,
    expectedAiGeneration,
  };

  // Concurrent / retry-safe: any non-failed shopifyFileId means resume poll
  // (do not re-upload). Covers fully promoted rows and partial promotes where
  // fileCreate succeeded but mark-promoted had not finished.
  if (photo.shopifyFileId && photo.shopifyFileStatus !== "failed") {
    return await finishPromoteFromShopifyFile(
      ctx,
      connection,
      photoId,
      photo.shopifyFileId,
      photo,
      markOptions,
    );
  }

  if (!photo.storageId && !photo.shopifyFileId) {
    throw new ConvexError(
      "Photo has no Convex storage or Shopify file to promote.",
    );
  }

  if (!photo.storageId) {
    throw new ConvexError(
      "Photo has no Convex storage to promote (Shopify file failed or missing).",
    );
  }

  // Light concurrent-promote guard: re-read before upload so a racing promote
  // that already persisted shopifyFileId wins and we resume instead of re-upload.
  const latest = (await ctx.runQuery(productPhotosModel.getPhotoForPromote, {
    photoId,
  })) as { photo: PromotePhotoRow; sku: string } | null;
  if (
    latest?.photo.shopifyFileId &&
    latest.photo.shopifyFileStatus !== "failed"
  ) {
    return await finishPromoteFromShopifyFile(
      ctx,
      connection,
      photoId,
      latest.photo.shopifyFileId,
      latest.photo,
      markOptions,
    );
  }

  const storageId = photo.storageId;
  const blob = await ctx.storage.get(storageId);

  if (!blob) {
    throw new ConvexError("Could not load photo from Convex storage.");
  }

  const mimeType = blob.type || "image/jpeg";
  const extension = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : "jpg";
  const kindLabel = photo.kind === "ai" ? "ai" : "original";
  const data = await blob.arrayBuffer();
  let createdShopifyFileId: string | undefined;
  let persistedShopifyFileId = false;

  let file;
  try {
    file = await uploadImageBufferToShopify(
      connection,
      {
        alt: `${sku} ${kindLabel} photo`,
        data,
        filename: `${sku}-${kindLabel}-${photo.sortOrder}.${extension}`,
        mimeType,
      },
      {
        // Persist shopifyFileId immediately after fileCreate so a crash during
        // polling does not re-upload a duplicate Shopify file on retry. Do NOT
        // mark status "promoted" until poll confirms ready (GC skips non-promoted).
        // If eligibility fails after create, markPromotedInternal cannot stamp a
        // stale/regenerated row — best-effort delete the orphan Shopify File.
        onFileCreated: async (created) => {
          createdShopifyFileId = created.id;
          try {
            await assertStillEligibleForMarkPromoted(ctx, photoId, markOptions);
            await ctx.runMutation(productPhotosModel.markPromotedInternal, {
              photoId,
              shopifyFileId: created.id,
              shopifyFileStatus: created.status,
              shopifyFileUrl: created.url,
              keepStorageId: true,
              expectedAiGeneration,
              markAsPromoted: false,
            });
            persistedShopifyFileId = true;
          } catch (eligibilityError) {
            try {
              await deleteShopifyFiles(connection, [created.id]);
            } catch {
              // Best-effort orphan cleanup.
            }
            throw eligibilityError;
          }
        },
      },
    );
  } catch (error) {
    if (createdShopifyFileId && !persistedShopifyFileId) {
      try {
        await deleteShopifyFiles(connection, [createdShopifyFileId]);
      } catch {
        // Best-effort orphan cleanup when we never persisted the file id.
      }
    } else if (createdShopifyFileId) {
      await markPromoteFailedIfShopifyTerminal(
        ctx,
        connection,
        photoId,
        createdShopifyFileId,
      );
    }
    throw error;
  }

  if (file.url) {
    await confirmUrlFetchable(file.url);
  }

  await assertStillEligibleForMarkPromoted(ctx, photoId, markOptions);

  // Promote success clears this photo's storage; GC sweep is an orphan safety net.
  // Guard clear with the storage/generation this promote started with so a
  // concurrent regen cannot lose its new blob.
  await ctx.runMutation(productPhotosModel.markPromotedInternal, {
    photoId,
    shopifyFileId: file.id,
    shopifyFileStatus: file.status,
    shopifyFileUrl: file.url,
    keepStorageId: true,
    expectedAiGeneration,
    markAsPromoted: true,
  });
  await ctx.runMutation(productPhotosModel.clearStorageIdInternal, {
    photoId,
    expectedStorageId: storageId,
    expectedAiGeneration,
  });

  await schedulePromotedStorageGc(ctx);

  return {
    shopifyFileId: file.id,
    url: file.url,
    status: file.status,
  };
}

/** Resolve a Shopify connection (with access token) by id for listing-job promote. */
export const getConnectionById = internalQuery({
  args: {
    connectionId: v.id("shopifyConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);

    if (!connection || !connection.isActive) {
      return null;
    }

    return connection;
  },
});

/** Product's Shopify product GID for a photo row (detach media before fileDelete). */
export const getShopifyProductIdForPhoto = internalQuery({
  args: {
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);

    if (!photo) {
      return null;
    }

    const product = await ctx.db.get(photo.productId);
    return product?.shopifyProductId ?? null;
  },
});

export const startShopifyInstall = action({
  args: {
    sessionToken: v.string(),
    shopDomain: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const { clientId } = assertShopifyEnv();
    const now = Date.now();
    const shopDomain = normalizeShopDomain(args.shopDomain);
    const state = crypto.randomUUID();

    await ctx.runMutation(shopifyModel.createOAuthState, {
      sessionToken: args.sessionToken,
      shopDomain,
      state,
      expiresAt: now + OAUTH_STATE_TTL_MS,
      now,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      scope: SHOPIFY_SCOPES.join(","),
      redirect_uri: args.redirectUri,
      state,
    });

    return {
      authUrl: `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`,
    };
  },
});

export const currentConnection = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireSessionUser(ctx, args.sessionToken);
    const connections = await ctx.db
      .query("shopifyConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const currentConnection = connections
      .filter((connection) => connection.isActive)
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
      .at(0);

    if (!currentConnection) {
      return null;
    }

    return {
      shopDomain: currentConnection.shopDomain,
      isActive: currentConnection.isActive,
      scopes: currentConnection.scopes,
      createdAt: currentConnection.createdAt,
      updatedAt: currentConnection.updatedAt,
    };
  },
});

export const prepareFileUpload = action({
  args: {
    sessionToken: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(shopifyModel.currentActiveConnection, {
      sessionToken: args.sessionToken,
    });

    if (!connection) {
      throw new ConvexError("Connect Shopify before uploading photos.");
    }

    return await createStagedImageUpload(connection, {
      filename: args.filename,
      fileSize: args.fileSize,
      mimeType: args.mimeType || "image/jpeg",
    });
  },
});

export const finalizeFileUpload = action({
  args: {
    sessionToken: v.string(),
    originalSource: v.string(),
    alt: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(shopifyModel.currentActiveConnection, {
      sessionToken: args.sessionToken,
    });

    if (!connection) {
      throw new ConvexError("Connect Shopify before saving photos.");
    }

    let file = await createShopifyFile(connection, {
      alt: args.alt,
      originalSource: args.originalSource,
    });

    for (let attempt = 0; attempt < 4 && file.status !== "ready"; attempt += 1) {
      await wait(750);
      file = await getShopifyFile(connection, file.id);
    }

    return file;
  },
});

export const promotePhotoToShopify = action({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(shopifyModel.currentActiveConnection, {
      sessionToken: args.sessionToken,
    });

    if (!connection) {
      throw new ConvexError("Connect Shopify before promoting photos.");
    }

    return await promotePhotoWithConnection(ctx, connection, args.photoId, {
      requireApprovedAi: true,
    });
  },
});

/** Session-free promote for listing jobs (uses the job's Shopify connection). */
export const promotePhotoInternal = internalAction({
  args: {
    photoId: v.id("productPhotos"),
    connectionId: v.id("shopifyConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(shopifyModel.getConnectionById, {
      connectionId: args.connectionId,
    });

    if (!connection) {
      throw new ConvexError("Shopify connection for this listing job is missing or inactive.");
    }

    return await promotePhotoWithConnection(ctx, connection, args.photoId, {
      // Fail closed if the photo was un-approved after the job was enqueued.
      requireApprovedAi: false,
    });
  },
});

/**
 * Best-effort: detach Files from a product gallery, then delete the Files.
 * Used when regenerating/deleting photos that may already be attached to a
 * published Shopify product. photoAi.deleteShopifyFilesBestEffort should call
 * removeFileReferencesFromProductBestEffort (or this helper) when a product id
 * is known so product media is cleared before fileDelete.
 */
export async function removeFileReferencesFromProductBestEffort(
  connection: ShopifyConnection,
  input: { fileIds: string[]; productId: string },
) {
  const unique = [...new Set(input.fileIds.filter(Boolean))];
  if (unique.length === 0) {
    return;
  }

  for (const fileId of unique) {
    try {
      await removeFileReferenceFromProduct(connection, {
        fileId,
        productId: input.productId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const alreadyGone =
        /not found|does not exist|FILE_DOES_NOT_EXIST|already deleted|not associated|reference/i.test(
          message,
        );
      if (!alreadyGone) {
        console.error(
          "Failed to remove Shopify file reference from product:",
          message,
        );
      }
    }
  }
}

export const deleteProductPhoto = action({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
    confirmPublishedDelete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [connection, deletion, shopifyProductId] = await Promise.all([
      ctx.runQuery(shopifyModel.currentActiveConnection, {
        sessionToken: args.sessionToken,
      }),
      ctx.runQuery(productPhotosModel.getPhotoForDeletion, {
        photoId: args.photoId,
      }),
      ctx.runQuery(shopifyModel.getShopifyProductIdForPhoto, {
        photoId: args.photoId,
      }),
    ]);

    if (!deletion) {
      throw new ConvexError("Photo not found.");
    }

    if (deletion.shopifyFileIds.length > 0) {
      if (!connection) {
        throw new ConvexError("Connect Shopify before deleting stored photos.");
      }

      if (
        deletion.shopifyStatus === "published" &&
        !args.confirmPublishedDelete
      ) {
        throw new ConvexError(
          "This product is published. Confirm before deleting its Shopify file.",
        );
      }

      if (typeof shopifyProductId === "string" && shopifyProductId) {
        await removeFileReferencesFromProductBestEffort(connection, {
          fileIds: deletion.shopifyFileIds,
          productId: shopifyProductId,
        });
      }

      try {
        await deleteShopifyFiles(connection, deletion.shopifyFileIds);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        // Treat already-deleted / missing files as success; fail otherwise.
        const alreadyGone =
          /not found|does not exist|FILE_DOES_NOT_EXIST|already deleted/i.test(
            message,
          );

        if (!alreadyGone) {
          throw error instanceof ConvexError
            ? error
            : new ConvexError(message);
        }
      }
    }

    await ctx.runMutation(productPhotosModel.deletePhotoInternal, {
      photoId: args.photoId,
    });

    return {
      deletedFileIds: deletion.shopifyFileIds,
      photoId: args.photoId,
    };
  },
});

/**
 * Internal helper for photoAi regen: detach file refs from a product (if any),
 * then best-effort delete the Shopify Files. Prefer this over bare fileDelete
 * when the product may already be published with those media.
 *
 * photoAi note: replace deleteShopifyFilesBestEffort call sites that know a
 * shopifyProductId with this action (or call removeFileReferenceFromProduct
 * from shopifyClient before fileDelete).
 */
export const detachAndDeleteShopifyFiles = internalAction({
  args: {
    fileIds: v.array(v.string()),
    shopifyProductId: v.optional(v.string()),
    connectionId: v.optional(v.id("shopifyConnections")),
  },
  handler: async (ctx, args) => {
    const connection = args.connectionId
      ? await ctx.runQuery(shopifyModel.getConnectionById, {
          connectionId: args.connectionId,
        })
      : await ctx.runQuery(shopifyModel.firstActiveConnection, {});

    if (!connection) {
      return { deletedFileIds: [] as string[] };
    }

    if (args.shopifyProductId) {
      await removeFileReferencesFromProductBestEffort(connection, {
        fileIds: args.fileIds,
        productId: args.shopifyProductId,
      });
    }

    try {
      const deletedFileIds = await deleteShopifyFiles(
        connection,
        args.fileIds,
      );
      return { deletedFileIds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const alreadyGone =
        /not found|does not exist|FILE_DOES_NOT_EXIST|already deleted/i.test(
          message,
        );
      if (!alreadyGone) {
        console.error("Failed to delete Shopify files:", message);
      }
      return { deletedFileIds: [] as string[] };
    }
  },
});

export const deleteProductFile = action({
  args: {
    sessionToken: v.string(),
    productId: v.id("products"),
    confirmPublishedDelete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [connection, file] = await Promise.all([
      ctx.runQuery(shopifyModel.currentActiveConnection, {
        sessionToken: args.sessionToken,
      }),
      ctx.runQuery(productModel.getFileForDeletion, {
        productId: args.productId,
        sessionToken: args.sessionToken,
      }),
    ]);

    if (!connection) {
      throw new ConvexError("Connect Shopify before deleting stored photos.");
    }

    if (!file?.shopifyFileId) {
      throw new ConvexError("This product does not have a Shopify file to delete.");
    }

    if (file.shopifyStatus === "published" && !args.confirmPublishedDelete) {
      throw new ConvexError(
        "This product is published. Confirm before deleting its Shopify file.",
      );
    }

    const deletedFileIds = await deleteShopifyFiles(connection, [file.shopifyFileId]);

    await ctx.runMutation(productModel.markShopifyFileDeleted, {
      deletedAt: Date.now(),
      productId: args.productId,
      shopifyFileId: file.shopifyFileId,
    });

    return { deletedFileIds };
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireSessionUser(ctx, args.sessionToken);
    const connections = await ctx.db
      .query("shopifyConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();

    for (const connection of connections.filter((connection) => connection.isActive)) {
      await ctx.db.patch(connection._id, {
        isActive: false,
        updatedAt: now,
      });
    }
  },
});

export const handleShopifyCallback = httpAction(async (ctx, request) => {
  const { clientId, clientSecret } = assertShopifyEnv();
  const url = new URL(request.url);
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse("Shopify connection failed", error, 400);
  }

  if (!(await verifyShopifyHmac(url, clientSecret))) {
    return htmlResponse(
      "Shopify connection failed",
      "Invalid Shopify callback signature.",
      400,
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const shop = url.searchParams.get("shop");

  if (!code || !state || !shop) {
    return htmlResponse(
      "Shopify connection failed",
      "Missing Shopify callback parameters.",
      400,
    );
  }

  const shopDomain = normalizeShopDomain(shop);
  const tokenResponse = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    },
  );

  if (!tokenResponse.ok) {
    return htmlResponse(
      "Shopify connection failed",
      "Could not exchange the Shopify authorization code.",
      400,
    );
  }

  const tokenResult = (await tokenResponse.json()) as ShopifyAccessTokenResponse;

  if (!tokenResult.access_token) {
    return htmlResponse(
      "Shopify connection failed",
      "Shopify did not return an access token.",
      400,
    );
  }

  await ctx.runMutation(shopifyModel.storeConnectionFromOAuth, {
    state,
    shopDomain,
    accessToken: tokenResult.access_token,
    scopes: tokenResult.scope ? tokenResult.scope.split(",") : SHOPIFY_SCOPES,
    now: Date.now(),
  });

  return htmlResponse(
    "Shopify connected",
    "You can close this tab and return to Flashpart.",
  );
});
