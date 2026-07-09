import { ConvexError } from "convex/values";

export const SHOPIFY_API_VERSION = "2026-04";

type ShopifyConnection = {
  accessToken: string;
  shopDomain: string;
};

type ShopifyUserError = {
  field?: string[] | string | null;
  message: string;
  code?: string | null;
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export type StagedUploadTarget = {
  url: string;
  resourceUrl: string;
  parameters: Array<{ name: string; value: string }>;
};

export type ShopifyFile = {
  id: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  url?: string;
};

export type ShopifyProductMatch = {
  productId: string;
  variantId?: string;
};

function collectUserErrors(value: unknown): ShopifyUserError[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectUserErrors);
  }

  return Object.entries(value).flatMap(([key, nested]) => {
    if (
      (key === "userErrors" ||
        key === "mediaUserErrors" ||
        key === "productSetUserErrors") &&
      Array.isArray(nested)
    ) {
      return nested.filter(
        (item): item is ShopifyUserError =>
          item !== null &&
          typeof item === "object" &&
          "message" in item &&
          typeof item.message === "string",
      );
    }

    return collectUserErrors(nested);
  });
}

function userErrorMessage(errors: ShopifyUserError[]) {
  return errors
    .map((error) => {
      const field = Array.isArray(error.field)
        ? error.field.join(".")
        : error.field;

      return field ? `${field}: ${error.message}` : error.message;
    })
    .join("; ");
}

function assertNoUserErrors(payload: unknown) {
  const userErrors = collectUserErrors(payload);

  if (userErrors.length > 0) {
    throw new ConvexError(userErrorMessage(userErrors));
  }
}

function shopifyStatus(value: string | null | undefined): ShopifyFile["status"] {
  switch (value) {
    case "READY":
      return "ready";
    case "FAILED":
      return "failed";
    case "PROCESSING":
      return "processing";
    default:
      return "uploaded";
  }
}

function mediaImageUrl(file: {
  image?: { url?: string | null } | null;
  preview?: { image?: { url?: string | null } | null } | null;
}) {
  return file.image?.url ?? file.preview?.image?.url ?? undefined;
}

export function skuToShopifyHandle(sku: string) {
  return sku
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function shopifyGraphql<T>(
  connection: ShopifyConnection,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const response = await fetch(
    `https://${connection.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": connection.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    throw new ConvexError(
      `Shopify API request failed with status ${response.status}.`,
    );
  }

  const result = (await response.json()) as GraphqlResponse<T>;

  if (result.errors?.length) {
    throw new ConvexError(result.errors.map((error) => error.message).join("; "));
  }

  if (!result.data) {
    throw new ConvexError("Shopify API response did not include data.");
  }

  assertNoUserErrors(result.data);
  return result.data;
}

export async function createStagedImageUpload(
  connection: ShopifyConnection,
  input: { filename: string; mimeType: string; fileSize: number },
) {
  const data = await shopifyGraphql<{
    stagedUploadsCreate: {
      stagedTargets: StagedUploadTarget[];
    };
  }>(
    connection,
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      input: [
        {
          filename: input.filename,
          fileSize: input.fileSize.toString(),
          httpMethod: "POST",
          mimeType: input.mimeType,
          resource: "FILE",
        },
      ],
    },
  );
  const target = data.stagedUploadsCreate.stagedTargets.at(0);

  if (!target) {
    throw new ConvexError("Shopify did not return an upload target.");
  }

  return target;
}

export async function createShopifyFile(
  connection: ShopifyConnection,
  input: { alt: string; originalSource: string },
) {
  const data = await shopifyGraphql<{
    fileCreate: {
      files: Array<{
        id?: string;
        fileStatus?: string;
        image?: { url?: string | null } | null;
        preview?: { image?: { url?: string | null } | null } | null;
      } | null>;
    };
  }>(
    connection,
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          fileStatus
          ... on MediaImage {
            image {
              url
            }
            preview {
              image {
                url
              }
            }
          }
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    {
      files: [
        {
          alt: input.alt,
          contentType: "IMAGE",
          originalSource: input.originalSource,
        },
      ],
    },
  );
  const file = data.fileCreate.files.at(0);

  if (!file?.id) {
    throw new ConvexError("Shopify did not create an image file.");
  }

  return {
    id: file.id,
    status: shopifyStatus(file.fileStatus),
    url: mediaImageUrl(file),
  };
}

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function uploadImageBufferToShopify(
  connection: ShopifyConnection,
  input: {
    alt: string;
    data: ArrayBuffer;
    filename: string;
    mimeType: string;
  },
  options?: {
    /** Called immediately after Shopify fileCreate so callers can persist the id before polling. */
    onFileCreated?: (file: ShopifyFile) => Promise<void>;
  },
) {
  const target = await createStagedImageUpload(connection, {
    fileSize: input.data.byteLength,
    filename: input.filename,
    mimeType: input.mimeType,
  });
  const body = new FormData();

  for (const parameter of target.parameters) {
    body.append(parameter.name, parameter.value);
  }

  body.append(
    "file",
    new Blob([input.data], { type: input.mimeType }),
    input.filename,
  );

  const uploadResponse = await fetch(target.url, {
    body,
    method: "POST",
  });

  if (!uploadResponse.ok) {
    throw new ConvexError("Shopify photo upload failed during AI image save.");
  }

  let file = await createShopifyFile(connection, {
    alt: input.alt,
    originalSource: target.resourceUrl,
  });

  if (options?.onFileCreated) {
    await options.onFileCreated(file);
  }

  for (
    let attempt = 0;
    attempt < 8 && (file.status !== "ready" || !file.url);
    attempt += 1
  ) {
    if (file.status === "failed") {
      throw new ConvexError("Shopify image processing failed.");
    }

    await wait(750);
    file = await getShopifyFile(connection, file.id);
  }

  if (file.status !== "ready" || !file.url) {
    throw new ConvexError(
      "Shopify image was not ready with a fetchable URL in time.",
    );
  }

  return file;
}

export async function pollShopifyFileUntilReady(
  connection: ShopifyConnection,
  fileId: string,
  options?: { maxAttempts?: number; delayMs?: number },
) {
  const maxAttempts = options?.maxAttempts ?? 8;
  const delayMs = options?.delayMs ?? 750;
  let file = await getShopifyFile(connection, fileId);

  for (
    let attempt = 0;
    attempt < maxAttempts && (file.status !== "ready" || !file.url);
    attempt += 1
  ) {
    if (file.status === "failed") {
      throw new ConvexError("Shopify image processing failed.");
    }

    await wait(delayMs);
    file = await getShopifyFile(connection, fileId);
  }

  if (file.status !== "ready" || !file.url) {
    throw new ConvexError(
      "Shopify image was not ready with a fetchable URL in time.",
    );
  }

  return file;
}

export async function getShopifyFile(
  connection: ShopifyConnection,
  fileId: string,
) {
  const data = await shopifyGraphql<{
    node: {
      id?: string;
      fileStatus?: string;
      image?: { url?: string | null } | null;
      preview?: { image?: { url?: string | null } | null } | null;
    } | null;
  }>(
    connection,
    `query fileNode($id: ID!) {
      node(id: $id) {
        id
        ... on MediaImage {
          fileStatus
          image {
            url
          }
          preview {
            image {
              url
            }
          }
        }
      }
    }`,
    { id: fileId },
  );

  if (!data.node?.id) {
    throw new ConvexError("Shopify image file was not found.");
  }

  return {
    id: data.node.id,
    status: shopifyStatus(data.node.fileStatus),
    url: mediaImageUrl(data.node),
  };
}

export async function deleteShopifyFiles(
  connection: ShopifyConnection,
  fileIds: string[],
) {
  const data = await shopifyGraphql<{
    fileDelete: {
      deletedFileIds: string[];
    };
  }>(
    connection,
    `mutation fileDelete($fileIds: [ID!]!) {
      fileDelete(fileIds: $fileIds) {
        deletedFileIds
        userErrors {
          field
          message
          code
        }
      }
    }`,
    { fileIds },
  );

  return data.fileDelete.deletedFileIds;
}

export async function findProductBySku(
  connection: ShopifyConnection,
  sku: string,
) {
  const data = await shopifyGraphql<{
    productVariants: {
      nodes: Array<{
        id: string;
        product: {
          id: string;
        };
      }>;
    };
  }>(
    connection,
    `query productBySku($query: String!) {
      productVariants(first: 1, query: $query) {
        nodes {
          id
          product {
            id
          }
        }
      }
    }`,
    { query: `sku:${JSON.stringify(sku)}` },
  );
  const match = data.productVariants.nodes.at(0);

  return match
    ? {
        productId: match.product.id,
        variantId: match.id,
      }
    : null;
}

export async function createShopifyProduct(
  connection: ShopifyConnection,
  input: {
    handle: string;
    productType?: string;
    publishTarget: "draft" | "published";
    tags?: string[];
    title: string;
    vendor?: string;
  },
) {
  const data = await shopifyGraphql<{
    productCreate: {
      product: {
        id: string;
        handle: string;
        status: string;
      } | null;
    };
  }>(
    connection,
    `mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          handle
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      product: {
        handle: input.handle,
        ...(input.productType ? { productType: input.productType } : {}),
        status: input.publishTarget === "published" ? "ACTIVE" : "DRAFT",
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
        title: input.title,
        ...(input.vendor ? { vendor: input.vendor } : {}),
      },
    },
  );

  if (!data.productCreate.product) {
    throw new ConvexError("Shopify did not create a product.");
  }

  return data.productCreate.product;
}

export async function updateShopifyProduct(
  connection: ShopifyConnection,
  input: {
    handle: string;
    productId: string;
    productType?: string;
    publishTarget: "draft" | "published";
    tags?: string[];
    title: string;
    vendor?: string;
  },
) {
  const data = await shopifyGraphql<{
    productUpdate: {
      product: {
        id: string;
        handle: string;
        status: string;
      } | null;
    };
  }>(
    connection,
    `mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          handle
          status
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      product: {
        handle: input.handle,
        id: input.productId,
        ...(input.productType ? { productType: input.productType } : {}),
        status: input.publishTarget === "published" ? "ACTIVE" : "DRAFT",
        ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
        title: input.title,
        ...(input.vendor ? { vendor: input.vendor } : {}),
      },
    },
  );

  if (!data.productUpdate.product) {
    throw new ConvexError("Shopify did not update the existing product.");
  }

  return data.productUpdate.product;
}

export async function createShopifyVariant(
  connection: ShopifyConnection,
  input: {
    barcode: string;
    price: number;
    productId: string;
    sku: string;
  },
) {
  const data = await shopifyGraphql<{
    productVariantsBulkCreate: {
      productVariants: Array<{ id: string }>;
    };
  }>(
    connection,
    `mutation productVariantsBulkCreate(
      $productId: ID!
      $strategy: ProductVariantsBulkCreateStrategy
      $variants: [ProductVariantsBulkInput!]!
    ) {
      productVariantsBulkCreate(
        productId: $productId
        strategy: $strategy
        variants: $variants
      ) {
        productVariants {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      productId: input.productId,
      strategy: "REMOVE_STANDALONE_VARIANT",
      variants: [
        {
          barcode: input.barcode,
          inventoryItem: {
            sku: input.sku,
          },
          price: input.price.toFixed(2),
        },
      ],
    },
  );
  const variant = data.productVariantsBulkCreate.productVariants.at(0);

  if (!variant) {
    throw new ConvexError("Shopify did not create a product variant.");
  }

  return variant;
}

export async function updateShopifyVariant(
  connection: ShopifyConnection,
  input: {
    barcode: string;
    price: number;
    productId: string;
    sku: string;
    variantId: string;
  },
) {
  const data = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string }>;
    };
  }>(
    connection,
    `mutation productVariantsBulkUpdate(
      $productId: ID!
      $variants: [ProductVariantsBulkInput!]!
    ) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      productId: input.productId,
      variants: [
        {
          barcode: input.barcode,
          id: input.variantId,
          inventoryItem: {
            sku: input.sku,
          },
          price: input.price.toFixed(2),
        },
      ],
    },
  );
  const variant = data.productVariantsBulkUpdate.productVariants.at(0);

  if (!variant) {
    throw new ConvexError("Shopify did not update the product variant.");
  }

  return variant;
}

export async function addFileReferenceToProduct(
  connection: ShopifyConnection,
  input: {
    fileId: string;
    productId: string;
  },
) {
  await shopifyGraphql<{
    fileUpdate: {
      files: Array<{ id: string }>;
    };
  }>(
    connection,
    `mutation fileUpdate($files: [FileUpdateInput!]!) {
      fileUpdate(files: $files) {
        files {
          id
        }
        userErrors {
          field
          message
          code
        }
      }
    }`,
    {
      files: [
        {
          id: input.fileId,
          referencesToAdd: [input.productId],
        },
      ],
    },
  );
}
