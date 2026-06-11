import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { AuthSession } from "../lib/auth-session";
import { convexApi } from "../lib/convex-api";

type Product = FunctionReturnType<typeof convexApi.products.list>[number];
type Group = FunctionReturnType<typeof convexApi.groups.list>[number];
type ListingJob = FunctionReturnType<typeof convexApi.listingJobs.list>[number];
type DuplicatePolicy = "blockExisting" | "updateExisting";
type ConvexSettings = FunctionReturnType<typeof convexApi.settings.get>;
type Settings = Omit<ConvexSettings, "duplicatePolicy"> & {
  duplicatePolicy: DuplicatePolicy;
};
type ShopifyConnection = FunctionReturnType<typeof convexApi.shopify.currentConnection>;

type ProductStatus = Product["status"];
type ImportedProduct = {
  sku: string;
  name: string;
  price: number;
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
    price?: number;
    duplicatePolicy?: DuplicatePolicy;
  }) => Promise<null>;
  deleteProducts: (ids: Id<"products">[]) => Promise<{ deleted: number } | null>;
  importProducts: (args: {
    products: ImportedProduct[];
    existingEntryBehavior: ExistingEntryBehavior;
  }) => Promise<{
    ignored: number;
    inserted: number;
    overwritten: number;
  } | null>;
  assignProductsToGroup: (
    groupId: Id<"groups">,
    productIds: Id<"products">[],
  ) => Promise<{ assigned: number } | null>;
  publishProducts: (
    productIds: Id<"products">[],
  ) => Promise<{ queued: number } | null>;
  setDuplicatePolicy: (
    duplicatePolicy: DuplicatePolicy,
  ) => Promise<{ updatedProducts: number } | null>;
  disconnectShopify: () => Promise<null>;
  createGroup: (name: string) => Promise<Id<"groups">>;
  assignFirstUngrouped: (
    groupId: Id<"groups">,
  ) => Promise<{ assigned: number } | null>;
  uploadCaptureImage: (file: File) => Promise<Id<"_storage">>;
  recordCapture: (args: {
    productId: Id<"products">;
    groupId: Id<"groups">;
    rawImageStorageId?: Id<"_storage">;
  }) => Promise<Id<"captures">>;
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
  return product.status === "draftCreated" || product.status === "needsReview";
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
  const importProductsMutation = useMutation(convexApi.products.importProducts);
  const deleteProductsMutation = useMutation(convexApi.products.removeMany);
  const assignProductsMutation = useMutation(convexApi.groups.assignProducts);
  const publishProductsMutation = useMutation(
    convexApi.listingJobs.enqueueCreateDrafts,
  );
  const setDuplicatePolicyMutation = useMutation(
    convexApi.settings.setDuplicatePolicy,
  );
  const disconnectShopifyMutation = useMutation(convexApi.shopify.disconnect);
  const createGroupMutation = useMutation(convexApi.groups.create);
  const assignFirstUngroupedMutation = useMutation(
    convexApi.groups.assignFirstUngrouped,
  );
  const recordCaptureMutation = useMutation(convexApi.captures.record);
  const generateUploadUrlMutation = useMutation(
    convexApi.captures.generateUploadUrl,
  );
  const operationIdRef = React.useRef(0);
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
      settings: (settings as Settings | undefined) ?? null,
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
      assignProductsToGroup: (groupId, productIds) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: state.products.map((product) =>
              productIds.includes(product._id)
                ? {
                    ...product,
                    groupId,
                    status:
                      product.status === "imported"
                        ? ("grouped" satisfies ProductStatus)
                        : product.status,
                    updatedAt: Date.now(),
                  }
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
              status: "processing",
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
            products: patchProducts(state.products, state.products.map((product) => product._id), {
              duplicatePolicy,
            }),
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
      disconnectShopify: () =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            shopifyConnection: null,
          }),
          commit: () => disconnectShopifyMutation(queryArgs),
          label: "Disconnecting Shopify",
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
                ? {
                    ...product,
                    groupId,
                    status: "grouped",
                    updatedAt: Date.now(),
                  }
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
      uploadCaptureImage: async (file) => {
        const uploadUrl = await generateUploadUrlMutation({
          sessionToken: session.sessionToken,
        });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        if (!response.ok) {
          throw new Error("Photo upload failed. Check your connection and retry.");
        }

        const { storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        };

        return storageId;
      },
      recordCapture: (args) =>
        runOptimistic({
          apply: (state) => ({
            ...state,
            products: updateProductFields(state.products, args.productId, {
              status: "captured",
            }),
          }),
          commit: () =>
            recordCaptureMutation({ ...args, sessionToken: session.sessionToken }),
          label: "Recording capture",
          productIds: [args.productId],
        }),
    }),
    [
      assignFirstUngroupedMutation,
      assignProductsMutation,
      createGroupMutation,
      deleteProductsMutation,
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
      generateUploadUrlMutation,
      pendingProductIds,
      products,
      publishProductsMutation,
      queryArgs,
      recordCaptureMutation,
      runOptimistic,
      session.sessionToken,
      session,
      setDuplicatePolicyMutation,
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
