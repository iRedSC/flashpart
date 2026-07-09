import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  httpAction,
  internalAction,
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

async function promotePhotoWithConnection(
  ctx: ActionCtx,
  connection: ShopifyConnection,
  photoId: Id<"productPhotos">,
) {
  const payload = (await ctx.runQuery(productPhotosModel.getPhotoForPromote, {
    photoId,
  })) as {
    photo: {
      _id: Id<"productPhotos">;
      kind: "original" | "ai";
      storageId?: Id<"_storage">;
      shopifyFileId?: string;
      shopifyFileStatus?: "uploaded" | "processing" | "ready" | "failed";
      status: "uploading" | "ready" | "failed" | "promoted";
      url?: string;
      sortOrder: number;
    };
    sku: string;
  } | null;

  if (!payload?.photo) {
    throw new ConvexError("Photo not found.");
  }

  const { photo, sku } = payload;

  // Retry-safe: already promoted with Shopify file → ensure storage cleared.
  if (
    photo.shopifyFileId &&
    (photo.status === "promoted" || photo.shopifyFileStatus === "ready")
  ) {
    let file = {
      id: photo.shopifyFileId,
      status: photo.shopifyFileStatus ?? ("ready" as const),
      url: photo.url,
    };

    if (file.status !== "ready" || !file.url) {
      const polled = await pollShopifyFileUntilReady(
        connection,
        photo.shopifyFileId,
      );
      file = polled;
      await ctx.runMutation(productPhotosModel.markPromotedInternal, {
        photoId,
        shopifyFileId: file.id,
        shopifyFileStatus: file.status,
        shopifyFileUrl: file.url,
        keepStorageId: true,
      });
    }

    if (photo.storageId) {
      await ctx.runMutation(productPhotosModel.clearStorageIdInternal, {
        photoId,
      });
    }

    await schedulePromotedStorageGc(ctx);

    return {
      shopifyFileId: file.id,
      url: file.url,
      status: file.status,
    };
  }

  if (!photo.storageId && !photo.shopifyFileId) {
    throw new ConvexError(
      "Photo has no Convex storage or Shopify file to promote.",
    );
  }

  // Partial promote: Shopify file exists but not yet marked ready/promoted.
  if (photo.shopifyFileId) {
    const file = await pollShopifyFileUntilReady(
      connection,
      photo.shopifyFileId,
    );

    if (file.url) {
      await confirmUrlFetchable(file.url);
    }

    await ctx.runMutation(productPhotosModel.markPromotedInternal, {
      photoId,
      shopifyFileId: file.id,
      shopifyFileStatus: file.status,
      shopifyFileUrl: file.url,
      keepStorageId: true,
    });
    await ctx.runMutation(productPhotosModel.clearStorageIdInternal, {
      photoId,
    });

    await schedulePromotedStorageGc(ctx);

    return {
      shopifyFileId: file.id,
      url: file.url,
      status: file.status,
    };
  }

  const storageId = photo.storageId!;
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
  const file = await uploadImageBufferToShopify(connection, {
    alt: `${sku} ${kindLabel} photo`,
    data,
    filename: `${sku}-${kindLabel}-${photo.sortOrder}.${extension}`,
    mimeType,
  });

  if (file.url) {
    await confirmUrlFetchable(file.url);
  }

  // Promote success clears this photo's storage; GC sweep is an orphan safety net.
  await ctx.runMutation(productPhotosModel.markPromotedInternal, {
    photoId,
    shopifyFileId: file.id,
    shopifyFileStatus: file.status,
    shopifyFileUrl: file.url,
    keepStorageId: true,
  });
  await ctx.runMutation(productPhotosModel.clearStorageIdInternal, {
    photoId,
  });

  await schedulePromotedStorageGc(ctx);

  return {
    shopifyFileId: file.id,
    url: file.url,
    status: file.status,
  };
}

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

    return await promotePhotoWithConnection(ctx, connection, args.photoId);
  },
});

/** Session-free promote for listing jobs (uses first active Shopify connection). */
export const promotePhotoInternal = internalAction({
  args: {
    photoId: v.id("productPhotos"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(shopifyModel.firstActiveConnection, {});

    if (!connection) {
      throw new ConvexError("Connect Shopify before promoting photos.");
    }

    return await promotePhotoWithConnection(ctx, connection, args.photoId);
  },
});

export const deleteProductPhoto = action({
  args: {
    sessionToken: v.string(),
    photoId: v.id("productPhotos"),
    confirmPublishedDelete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const [connection, deletion] = await Promise.all([
      ctx.runQuery(shopifyModel.currentActiveConnection, {
        sessionToken: args.sessionToken,
      }),
      ctx.runQuery(productPhotosModel.getPhotoForDeletion, {
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

      await deleteShopifyFiles(connection, deletion.shopifyFileIds).catch(
        () => undefined,
      );
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
