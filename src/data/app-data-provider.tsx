import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { AuthSession } from "../lib/auth-session";
import { convexApi } from "../lib/convex-api";
import { isGroupCaptureComplete } from "../lib/product-state";
import type { AiImageEditStrength, AiImageModelId } from "../lib/ai-image-settings";

type Product = FunctionReturnType<typeof convexApi.products.list>[number];
type Group = FunctionReturnType<typeof convexApi.groups.list>[number];
type ListingJob = FunctionReturnType<typeof convexApi.listingJobs.list>[number];
type DuplicatePolicy = "blockExisting" | "updateExisting";
type ShopifyPublishTarget = "draft" | "published";
type ConvexSettings = FunctionReturnType<typeof convexApi.settings.get>;
type Settings = Omit<ConvexSettings, "duplicatePolicy"> & {
  duplicatePolicy: DuplicatePolicy;
  shopifyPublishTarget: ShopifyPublishTarget;
};
type ShopifyConnection = FunctionReturnType<typeof convexApi.shopify.currentConnection>;
type ShopifyFileUpload = {
  shopifyFileId: string;
  shopifyFileStatus: "uploaded" | "processing" | "ready" | "failed";
  shopifyFileUrl?: string;
  shopifyStagedResourceUrl: string;
};

type ImportedProduct = {
  sku: string;
  name: string;
  price: number;
  description?: string;
  vendor?: string;
  tags?: string;
};
type ExistingEntryBehavior = "overwrite" | "ignore";

type OptimisticState = {
  products: Product[];
  groups: Group[];
  listingJobs: ListingJob[];
  settings: Settings | null;
  shopifyConnection: ShopifyConnection;
};

type OptimisticOperation = {
  id: string;
  label: string;
  productIds?: Id<"products">[];
  apply: (state: OptimisticState) => OptimisticState;
};

type OptimisticMutationError = {
  id: string;
  label: string;
  message: string;
};

type AppDataContextValue = {
  session: AuthSession;
  products: Product[];
  groups: Group[];
  listingJobs: ListingJob[];
  settings: Settings | null;
  shopifyConnection: ShopifyConnection;
  isLoading: boolean;
  pendingOperationCount: number;
  pendingOperations: Pick<OptimisticOperation, "id" | "label">[];
  lastMutationError: OptimisticMutationError | null;
  clearMutationError: () => void;
  isProductPending: (id: Id<"products">) => boolean;
  updateProduct: (args: {
    id: Id<"products">;
    sku?: string;
    name?: string;
    description?: string;
    vendor?: string;
    tags?: string;
    price?: number;
  }) => Promise<null>;
  deleteProducts: (ids: Id<"products">[]) => Promise<{ deleted: number } | null>;
  reorderProducts: (
    orderedIds: Id<"products">[],
  ) => Promise<{ updated: number } | null>;
  importProducts: (args: {
    products: ImportedProduct[];
    existingEntryBehavior: ExistingEntryBehavior;
  }) => Promise<{
    ignored: number;
    inserted: number;
    overwritten: number;
  } | null>;
  createProduct: (args: ImportedProduct) => Promise<{ id: Id<"products"> } | null>;
  assignProductsToGroup: (
    groupId: Id<"groups">,
    productIds: Id<"products">[],
  ) => Promise<{ assigned: number } | null>;
  publishProducts: (
    productIds: Id<"products">[],
  ) => Promise<{ queued: number } | null>;
  setDuplicatePolicy: (
    duplicatePolicy: DuplicatePolicy,
  ) => Promise<{ duplicatePolicy: DuplicatePolicy } | null>;
  setShopifyPublishTarget: (
    shopifyPublishTarget: ShopifyPublishTarget,
  ) => Promise<{ shopifyPublishTarget: ShopifyPublishTarget } | null>;
  setShopifyProductType: (
    shopifyProductType: string,
  ) => Promise<{ shopifyProductType: string } | null>;
  setShopifyDefaultTags: (
    shopifyDefaultTags: string,
  ) => Promise<{ shopifyDefaultTags: string | undefined } | null>;
  setAiImageDefaultPrompt: (
    aiImageDefaultPrompt: string,
  ) => Promise<{ aiImageDefaultPrompt: string } | null>;
  setAiImageModel: (
    aiImageModel: AiImageModelId,
  ) => Promise<{ aiImageModel: AiImageModelId } | null>;
  setAiImageEditStrength: (
    aiImageEditStrength: AiImageEditStrength,
  ) => Promise<{ aiImageEditStrength: AiImageEditStrength } | null>;
  disconnectShopify: () => Promise<null>;
  deleteShopifyFile: (
    productId: Id<"products">,
    confirmPublishedDelete?: boolean,
  ) => Promise<{ deletedFileIds: string[] } | null>;
  createGroup: (name: string) => Promise<Id<"groups">>;
  assignFirstUngrouped: (
    groupId: Id<"groups">,
  ) => Promise<{ assigned: number } | null>;
  deleteGroup: (
    groupId: Id<"groups">,
  ) => Promise<{ deleted: boolean; ungrouped: number } | null>;
  uploadCaptureImage: (file: File) => Promise<ShopifyFileUpload>;
  recordCapture: (args: {
    productId: Id<"products">;
    groupId: Id<"groups">;
    shopifyFileId?: string;
    shopifyFileStatus?: ShopifyFileUpload["shopifyFileStatus"];
    shopifyFileUrl?: string;
    shopifyStagedResourceUrl?: string;
  }) => Promise<Id<"captures">>;
  submitCapture: (args: {
    productId: Id<"products">;
    groupId: Id<"groups">;
    file?: File;
  }) => Promise<Id<"captures">>;
  regenerateAiImage: (args: {
    productId: Id<"products">;
    prompt: string;
  }) => Promise<null>;
  approvePhoto: (productId: Id<"products">) => Promise<null>;
};

const AppDataContext = React.createContext<AppDataContextValue | null>(null);

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "The change could not be saved.";
}

function patchProducts(
  products: Product[],
  ids: Id<"products">[],
  patch: Partial<Product>,
) {
  const idSet = new Set(ids);
  const updatedAt = Date.now();

  return products.map((product) =>
    idSet.has(product._id) ? { ...product, ...patch, updatedAt } : product,
  );
}

function updateProductFields(
  products: Product[],
  id: Id<"products">,
  patch: Partial<Product>,
) {
  return patchProducts(products, [id], patch);
}

function completedForGroups(product: Product) {
  return isGroupCaptureComplete(product);
}

function recomputeGroupCounts(groups: Group[], products: Product[]) {
  return groups.map((group) => {
    const groupProducts = products.filter((product) => product.groupId === group._id);

    return {
      ...group,
      productCount: groupProducts.length,
      completedCount: groupProducts.filter(completedForGroups).length,
    };
  });
}

export function AppDataProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: AuthSession;
}) {
  const queryArgs = React.useMemo(
    () => ({ sessionToken: session.sessionToken }),
    [session.sessionToken],
  );
  const products = useQuery(convexApi.products.list, queryArgs);
  const groups = useQuery(convexApi.groups.list, queryArgs);
  const listingJobs = useQuery(convexApi.listingJobs.list, queryArgs);
  const settings = useQuery(convexApi.settings.get, queryArgs);
  const shopifyConnection = useQuery(convexApi.shopify.currentConnection, queryArgs);
  const updateProductMutation = useMutation(convexApi.products.update);
  const createProductMutation = useMutation(convexApi.products.create);
  const importProductsMutation = useMutation(convexApi.products.importProducts);
  const deleteProductsMutation = useMutation(convexApi.products.removeMany);
  const reorderProductsMutation = useMutation(convexApi.products.reorder);
  const assignProductsMutation = useMutation(convexApi.groups.assignProducts);
  const publishProductsMutation = useMutation(
    convexApi.listingJobs.enqueueCreateDrafts,
  );
  const setDuplicatePolicyMutation = useMutation(
    convexApi.settings.setDuplicatePolicy,
  );
  const setShopifyPublishTargetMutation = useMutation(
    convexApi.settings.setShopifyPublishTarget,
  );
  const setShopifyProductTypeMutation = useMutation(
    convexApi.settings.setShopifyProductType,
  );
  const setShopifyDefaultTagsMutation = useMutation(
    convexApi.settings.setShopifyDefaultTags,
  );
  const setAiImageDefaultPromptMutation = useMutation(
    convexApi.settings.setAiImageDefaultPrompt,
  );
  const setAiImageModelMutation = useMutation(convexApi.settings.setAiImageModel);
  const setAiImageEditStrengthMutation = useMutation(
    convexApi.settings.setAiImageEditStrength,
  );
  const disconnectShopifyMutation = useMutation(convexApi.shopify.disconnect);
  const prepareFileUploadAction = useAction(convexApi.shopify.prepareFileUpload);
  const finalizeFileUploadAction = useAction(convexApi.shopify.finalizeFileUpload);
  const deleteProductFileAction = useAction(convexApi.shopify.deleteProductFile);
  const createGroupMutation = useMutation(convexApi.groups.create);
  const assignFirstUngroupedMutation = useMutation(
    convexApi.groups.assignFirstUngrouped,
  );
  const deleteGroupMutation = useMutation(convexApi.groups.remove);
  const recordCaptureMutation = useMutation(convexApi.captures.record);
  const regenerateAiImageMutation = useMutation(convexApi.photoAi.regenerate);
  const approvePhotoMutation = useMutation(convexApi.photoAi.approvePhoto);
  const operationIdRef = React.useRef(0);
  const hasInitializedFailedJobTrackingRef = React.useRef(false);
  const seenFailedListingJobIdsRef = React.useRef<Set<string>>(new Set());
  const [optimisticOperations, setOptimisticOperations] = React.useState<
    OptimisticOperation[]
  >([]);
  const [lastMutationError, setLastMutationError] =
    React.useState<OptimisticMutationError | null>(null);
  const baseData = React.useMemo<OptimisticState>(
    () => ({
      products: products ?? [],
      groups: groups ?? [],
      listingJobs: listingJobs ?? [],
      settings: settings
        ? ({
            ...settings,
            shopifyPublishTarget: settings.shopifyPublishTarget ?? "draft",
          } satisfies Settings)
        : null,
      shopifyConnection: shopifyConnection ?? null,
    }),
    [groups, listingJobs, products, settings, shopifyConnection],
  );
  const optimisticData = React.useMemo<OptimisticState>(() => {
    const patched = optimisticOperations.reduce(
      (state, operation) => operation.apply(state),
      baseData,
    );

    return {
      ...patched,
      groups: recomputeGroupCounts(patched.groups, patched.products),
    };
  }, [baseData, optimisticOperations]);
  const pendingProductIds = React.useMemo(() => {
    const ids = new Set<Id<"products">>();

    for (const operation of optimisticOperations) {
      for (const productId of operation.productIds ?? []) {
        ids.add(productId);
      }
    }

    return ids;
  }, [optimisticOperations]);
  React.useEffect(() => {
    if (listingJobs === undefined) {
      return;
    }

    const failedJobs = listingJobs.filter((job) => job.status === "failed");
    const seenFailedJobIds = seenFailedListingJobIdsRef.current;

    if (!hasInitializedFailedJobTrackingRef.current) {
      for (const job of failedJobs) {
        seenFailedJobIds.add(job._id);
      }
      hasInitializedFailedJobTrackingRef.current = true;
      return;
    }

    const newlyFailedJob = failedJobs.find((job) => !seenFailedJobIds.has(job._id));

    for (const job of failedJobs) {
      seenFailedJobIds.add(job._id);
    }

    if (newlyFailedJob) {
      setLastMutationError({
        id: newlyFailedJob._id,
        label: "Publishing product",
        message: newlyFailedJob.error ?? "Shopify listing job failed.",
      });
    }
  }, [listingJobs]);
  const uploadCaptureFile = React.useCallback(
    async (file: File): Promise<ShopifyFileUpload> => {
      const target = await prepareFileUploadAction({
        fileSize: file.size,
        filename: file.name || "capture.jpg",
        mimeType: file.type || "image/jpeg",
        sessionToken: session.sessionToken,
      });

      const body = new FormData();

      for (const parameter of target.parameters) {
        body.append(parameter.name, parameter.value);
      }

      body.append("file", file);

      const response = await fetch(target.url, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        throw new Error("Shopify photo upload failed. Check your connection and retry.");
      }

      const fileRecord = await finalizeFileUploadAction({
        alt: file.name || "Product photo",
        originalSource: target.resourceUrl,
        sessionToken: session.sessionToken,
      });

      return {
        shopifyFileId: fileRecord.id,
        shopifyFileStatus: fileRecord.status,
        shopifyFileUrl: fileRecord.url,
        shopifyStagedResourceUrl: target.resourceUrl,
      };
    },
    [finalizeFileUploadAction, prepareFileUploadAction, session.sessionToken],
  );
  const runOptimistic = React.useCallback(
    async <T,>({
      apply,
      commit,
      label,
      productIds,
    }: {
      apply: (state: OptimisticState) => OptimisticState;
      commit: () => Promise<T>;
      label: string;
      productIds?: Id<"products">[];
    }) => {
      const id = `optimistic-${Date.now()}-${operationIdRef.current++}`;

      setLastMutationError(null);
      setOptimisticOperations((current) => [
        ...current,
        { apply, id, label, productIds },
      ]);

      try {
        return await commit();
      } catch (error) {
        setLastMutationError({
          id,
          label,
          message: messageFromError(error),
        });
        throw error;
      } finally {
        setOptimisticOperations((current) =>
          current.filter((operation) => operation.id !== id),
        );
      }
    },
    [],
  );

  const value = React.useMemo<AppDataContextValue>(
    () => ({
      products: optimisticData.products,
      session,
      groups: optimisticData.groups,
      listingJobs: optimisticData.listingJobs,
      settings: optimisticData.settings,
      shopifyConnection: optimisticData.shopifyConnection,
      isLoading:
        products === undefined ||
        groups === undefined ||
        listingJobs === undefined ||
        settings === undefined ||
        shopifyConnection === undefined,
      pendingOperationCount: optimisticOperations.length,
      pendingOperations: optimisticOperations.map(({ id, label }) => ({ id, label })),
      lastMutationError,
      clearMutationError: () => setLastMutationError(null),
      isProductPending: (id) => pendingProductIds.has(id),
      updateProduct: (args) => {
        const { id, ...patch } = args;

        return runOptimistic({
          apply: (state) => ({
            ...state,
            products: updateProductFields(state.products, id, patch),
          }),
          commit: () =>
            updateProductMutation({
              ...args,
              sessionToken: session.sessionToken,
            }),
          label: "Saving product edit",
          productIds: [id],
        });
      },
      deleteProducts: (ids) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: state.products.filter((product) => !ids.includes(product._id)),
          }),
          commit: () =>
            deleteProductsMutation({
              ids,
              sessionToken: session.sessionToken,
            }),
          label:
            ids.length === 1
              ? "Deleting product"
              : `Deleting ${ids.length.toLocaleString()} products`,
          productIds: ids,
        }),
      reorderProducts: (orderedIds) => {
        const indexById = new Map(orderedIds.map((id, index) => [id, index]));

        return runOptimistic({
          apply: (state) => ({
            ...state,
            products: state.products
              .map((product, index) => ({
                product,
                // Unknown ids (e.g. concurrent optimistic inserts) keep their
                // relative position after the reordered set.
                key: indexById.get(product._id) ?? orderedIds.length + index,
              }))
              .sort((left, right) => left.key - right.key)
              .map((entry) => entry.product),
          }),
          commit: () =>
            reorderProductsMutation({
              orderedIds,
              sessionToken: session.sessionToken,
            }),
          label: "Saving product order",
        });
      },
      importProducts: (args) =>
        runOptimistic({
          apply: (state) => state,
          commit: () =>
            importProductsMutation({
              ...args,
              sessionToken: session.sessionToken,
            }),
          label: `Importing ${args.products.length.toLocaleString()} products`,
        }),
      createProduct: (args) => {
        const sku = args.sku.trim();
        const name = args.name.trim();
        const now = Date.now();
        const optimisticId =
          `optimistic-product-${operationIdRef.current}` as Id<"products">;

        return runOptimistic({
          apply: (state) => ({
            ...state,
            products: [
              {
                _creationTime: now,
                _id: optimisticId,
                createdAt: now,
                lastError: undefined,
                needsPhotoReview: undefined,
                name,
                pendingOperation: undefined,
                phase: "imported",
                price: args.price,
                sku,
                updatedAt: now,
              },
              ...state.products,
            ],
          }),
          commit: () =>
            createProductMutation({
              name,
              price: args.price,
              sessionToken: session.sessionToken,
              sku,
            }),
          label: "Adding product",
        });
      },
      assignProductsToGroup: (groupId, productIds) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: state.products.map((product) =>
              productIds.includes(product._id)
                ? { ...product, groupId, updatedAt: Date.now() }
                : product,
            ),
          }),
          commit: () =>
            assignProductsMutation({
              groupId,
              productIds,
              sessionToken: session.sessionToken,
            }),
          label:
            productIds.length === 1
              ? "Assigning product to group"
              : `Assigning ${productIds.length.toLocaleString()} products to group`,
          productIds,
        }),
      publishProducts: (productIds) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: patchProducts(state.products, productIds, {
              lastError: undefined,
              pendingOperation: "publishing",
            }),
          }),
          commit: () =>
            publishProductsMutation({
              productIds,
              sessionToken: session.sessionToken,
            }),
          label:
            productIds.length === 1
              ? "Queuing Shopify draft"
              : `Queuing ${productIds.length.toLocaleString()} Shopify drafts`,
          productIds,
        }),
      setDuplicatePolicy: (duplicatePolicy) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  duplicatePolicy,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setDuplicatePolicyMutation({
              duplicatePolicy,
              sessionToken: session.sessionToken,
            }),
          label: "Saving existing SKU behavior",
        }),
      setShopifyPublishTarget: (shopifyPublishTarget) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  shopifyPublishTarget,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setShopifyPublishTargetMutation({
              sessionToken: session.sessionToken,
              shopifyPublishTarget,
            }),
          label: "Saving Shopify publish target",
        }),
      setShopifyProductType: (shopifyProductType) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  shopifyProductType,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setShopifyProductTypeMutation({
              sessionToken: session.sessionToken,
              shopifyProductType,
            }),
          label: "Saving Shopify product type",
        }),
      setShopifyDefaultTags: (shopifyDefaultTags) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  shopifyDefaultTags,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setShopifyDefaultTagsMutation({
              sessionToken: session.sessionToken,
              shopifyDefaultTags,
            }),
          label: "Saving default Shopify tags",
        }),
      setAiImageDefaultPrompt: (aiImageDefaultPrompt) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  aiImageDefaultPrompt,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setAiImageDefaultPromptMutation({
              aiImageDefaultPrompt,
              sessionToken: session.sessionToken,
            }),
          label: "Saving AI photo prompt",
        }),
      setAiImageModel: (aiImageModel) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  aiImageModel,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setAiImageModelMutation({
              aiImageModel,
              sessionToken: session.sessionToken,
            }),
          label: "Saving AI photo model",
        }),
      setAiImageEditStrength: (aiImageEditStrength) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            settings: state.settings
              ? {
                  ...state.settings,
                  aiImageEditStrength,
                  updatedAt: Date.now(),
                }
              : state.settings,
          }),
          commit: () =>
            setAiImageEditStrengthMutation({
              aiImageEditStrength,
              sessionToken: session.sessionToken,
            }),
          label: "Saving AI edit strength",
        }),
      disconnectShopify: () =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            shopifyConnection: null,
          }),
          commit: () => disconnectShopifyMutation(queryArgs),
          label: "Disconnecting Shopify",
        }),
      deleteShopifyFile: (productId, confirmPublishedDelete) =>
        runOptimistic({
          apply: (state) => {
            const now = Date.now();

            return {
              ...state,
              products: state.products.map((product) =>
                product._id === productId
                  ? {
                      ...product,
                      aiImageError: undefined,
                      aiImagePrompt: undefined,
                      aiImageStatus: undefined,
                      aiShopifyFileId: undefined,
                      aiShopifyFileStatus: undefined,
                      aiShopifyFileUrl: undefined,
                      shopifyFileDeletedAt: now,
                      shopifyFileId: undefined,
                      shopifyFileStatus: undefined,
                      shopifyFileUrl: undefined,
                      shopifyStagedResourceUrl: undefined,
                      captureId: undefined,
                      needsPhotoReview: undefined,
                      pendingOperation: undefined,
                      phase: "imported",
                      updatedAt: now,
                    }
                  : product,
              ),
            };
          },
          commit: () =>
            deleteProductFileAction({
              confirmPublishedDelete,
              productId,
              sessionToken: session.sessionToken,
            }),
          label: "Deleting Shopify photo",
          productIds: [productId],
        }),
      createGroup: (name) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            groups: [
              {
                _creationTime: Date.now(),
                _id: `optimistic-group-${operationIdRef.current}` as Id<"groups">,
                completedCount: 0,
                createdAt: Date.now(),
                name,
                productCount: 0,
                status: "active",
                updatedAt: Date.now(),
              },
              ...state.groups,
            ],
          }),
          commit: () =>
            createGroupMutation({ name, sessionToken: session.sessionToken }),
          label: "Creating group",
        }),
      assignFirstUngrouped: (groupId) => {
        const candidateIds = optimisticData.products
          .filter((product) => product.groupId === undefined)
          .map((product) => product._id);

        return runOptimistic({
          apply: (state) => ({
            ...state,
            products: state.products.map((product) =>
              candidateIds.includes(product._id)
                ? { ...product, groupId, updatedAt: Date.now() }
                : product,
            ),
          }),
          commit: () =>
            assignFirstUngroupedMutation({
              groupId,
              sessionToken: session.sessionToken,
            }),
          label: "Assigning ungrouped products",
          productIds: candidateIds,
        });
      },
      deleteGroup: (groupId) => {
        const affectedProductIds = optimisticData.products
          .filter((product) => product.groupId === groupId)
          .map((product) => product._id);

        return runOptimistic({
          apply: (state) => ({
            ...state,
            groups: state.groups.filter((group) => group._id !== groupId),
            products: state.products.map((product) =>
              product.groupId === groupId
                ? { ...product, groupId: undefined, updatedAt: Date.now() }
                : product,
            ),
          }),
          commit: () =>
            deleteGroupMutation({
              groupId,
              sessionToken: session.sessionToken,
            }),
          label: "Deleting group",
          productIds: affectedProductIds,
        });
      },
      uploadCaptureImage: uploadCaptureFile,
      recordCapture: (args) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: updateProductFields(state.products, args.productId, {
              aiImageStatus: args.shopifyFileId ? "generating" : undefined,
              aiShopifyFileUrl: undefined,
              lastError: undefined,
              needsPhotoReview: undefined,
              pendingOperation: args.shopifyFileId
                ? "aiImageGenerating"
                : undefined,
              phase: "captured",
            }),
          }),
          commit: () =>
            recordCaptureMutation({ ...args, sessionToken: session.sessionToken }),
          label: "Recording capture",
          productIds: [args.productId],
        }),
      submitCapture: (args) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: updateProductFields(state.products, args.productId, {
              aiImageStatus: args.file ? "generating" : undefined,
              aiShopifyFileUrl: undefined,
              lastError: undefined,
              needsPhotoReview: undefined,
              pendingOperation: args.file ? "aiImageGenerating" : undefined,
              phase: "captured",
            }),
          }),
          commit: async () => {
            const shopifyFile = args.file
              ? await uploadCaptureFile(args.file)
              : undefined;

            return recordCaptureMutation({
              groupId: args.groupId,
              productId: args.productId,
              sessionToken: session.sessionToken,
              ...shopifyFile,
            });
          },
          label: args.file ? "Uploading capture photo" : "Recording capture",
          productIds: [args.productId],
        }),
      regenerateAiImage: ({ productId, prompt }) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: updateProductFields(state.products, productId, {
              aiImageStatus: "generating",
              aiShopifyFileUrl: undefined,
              lastError: undefined,
              needsPhotoReview: undefined,
              pendingOperation: "aiImageGenerating",
            }),
          }),
          commit: () =>
            regenerateAiImageMutation({
              productId,
              prompt,
              sessionToken: session.sessionToken,
            }),
          label: "Regenerating AI photo",
          productIds: [productId],
        }),
      approvePhoto: (productId) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: updateProductFields(state.products, productId, {
              needsPhotoReview: undefined,
            }),
          }),
          commit: () =>
            approvePhotoMutation({
              productId,
              sessionToken: session.sessionToken,
            }),
          label: "Approving AI photo",
          productIds: [productId],
        }),
    }),
    [
      assignFirstUngroupedMutation,
      assignProductsMutation,
      createGroupMutation,
      deleteGroupMutation,
      createProductMutation,
      deleteProductsMutation,
      deleteProductFileAction,
      finalizeFileUploadAction,
      importProductsMutation,
      groups,
      listingJobs,
      lastMutationError,
      optimisticData.groups,
      optimisticData.listingJobs,
      optimisticData.products,
      optimisticData.settings,
      optimisticData.shopifyConnection,
      optimisticOperations,
      pendingProductIds,
      prepareFileUploadAction,
      products,
      publishProductsMutation,
      queryArgs,
      approvePhotoMutation,
      recordCaptureMutation,
      regenerateAiImageMutation,
      reorderProductsMutation,
      runOptimistic,
      session.sessionToken,
      session,
      uploadCaptureFile,
      setAiImageDefaultPromptMutation,
      setAiImageEditStrengthMutation,
      setAiImageModelMutation,
      setDuplicatePolicyMutation,
      setShopifyPublishTargetMutation,
      setShopifyProductTypeMutation,
      setShopifyDefaultTagsMutation,
      disconnectShopifyMutation,
      settings,
      shopifyConnection,
      updateProductMutation,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = React.useContext(AppDataContext);

  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider");
  }

  return context;
}
