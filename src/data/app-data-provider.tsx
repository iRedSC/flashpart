import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Product = FunctionReturnType<typeof api.products.list>[number];
type Group = FunctionReturnType<typeof api.groups.list>[number];
type ListingJob = FunctionReturnType<typeof api.listingJobs.list>[number];
type Settings = FunctionReturnType<typeof api.settings.get>;
type ShopifyConnection = FunctionReturnType<typeof api.shopify.currentConnection>;

type AppDataContextValue = {
  products: Product[];
  groups: Group[];
  listingJobs: ListingJob[];
  settings: Settings | null;
  shopifyConnection: ShopifyConnection;
  isLoading: boolean;
  seedSampleProducts: () => Promise<{ inserted: number } | null>;
  updateProduct: (args: {
    id: Id<"products">;
    sku?: string;
    name?: string;
    price?: number;
    duplicatePolicy?: "blockExisting" | "updateExisting";
  }) => Promise<null>;
  setDuplicatePolicy: (
    duplicatePolicy: "blockExisting" | "updateExisting",
  ) => Promise<{ updatedProducts: number } | null>;
  disconnectShopify: () => Promise<null>;
  createGroup: (name: string) => Promise<Id<"groups">>;
  assignFirstUngrouped: (
    groupId: Id<"groups">,
    count: number,
  ) => Promise<{ assigned: number } | null>;
  recordCapture: (args: {
    productId: Id<"products">;
    groupId: Id<"groups">;
  }) => Promise<Id<"captures">>;
};

const AppDataContext = React.createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const products = useQuery(api.products.list);
  const groups = useQuery(api.groups.list);
  const listingJobs = useQuery(api.listingJobs.list);
  const settings = useQuery(api.settings.get);
  const shopifyConnection = useQuery(api.shopify.currentConnection);
  const seedSampleProductsMutation = useMutation(api.products.seedSampleProducts);
  const updateProductMutation = useMutation(api.products.update);
  const setDuplicatePolicyMutation = useMutation(api.settings.setDuplicatePolicy);
  const disconnectShopifyMutation = useMutation(api.shopify.disconnect);
  const createGroupMutation = useMutation(api.groups.create);
  const assignFirstUngroupedMutation = useMutation(api.groups.assignFirstUngrouped);
  const recordCaptureMutation = useMutation(api.captures.record);

  const value = React.useMemo<AppDataContextValue>(
    () => ({
      products: products ?? [],
      groups: groups ?? [],
      listingJobs: listingJobs ?? [],
      settings: settings ?? null,
      shopifyConnection: shopifyConnection ?? null,
      isLoading:
        products === undefined ||
        groups === undefined ||
        listingJobs === undefined ||
        settings === undefined ||
        shopifyConnection === undefined,
      seedSampleProducts: () => seedSampleProductsMutation({}),
      updateProduct: (args) => updateProductMutation(args),
      setDuplicatePolicy: (duplicatePolicy) =>
        setDuplicatePolicyMutation({ duplicatePolicy }),
      disconnectShopify: () => disconnectShopifyMutation({}),
      createGroup: (name) => createGroupMutation({ name }),
      assignFirstUngrouped: (groupId, count) =>
        assignFirstUngroupedMutation({ groupId, count }),
      recordCapture: (args) => recordCaptureMutation(args),
    }),
    [
      assignFirstUngroupedMutation,
      createGroupMutation,
      groups,
      listingJobs,
      products,
      recordCaptureMutation,
      seedSampleProductsMutation,
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
