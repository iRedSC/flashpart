import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { AuthSession } from "../lib/auth-session";
import { convexApi } from "../lib/convex-api";

type Product = FunctionReturnType<typeof convexApi.products.list>[number];
type Group = FunctionReturnType<typeof convexApi.groups.list>[number];
type ListingJob = FunctionReturnType<typeof convexApi.listingJobs.list>[number];
type Settings = FunctionReturnType<typeof convexApi.settings.get>;
type ShopifyConnection = FunctionReturnType<typeof convexApi.shopify.currentConnection>;

type AppDataContextValue = {
  session: AuthSession;
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
  const seedSampleProductsMutation = useMutation(
    convexApi.products.seedSampleProducts,
  );
  const updateProductMutation = useMutation(convexApi.products.update);
  const setDuplicatePolicyMutation = useMutation(
    convexApi.settings.setDuplicatePolicy,
  );
  const disconnectShopifyMutation = useMutation(convexApi.shopify.disconnect);
  const createGroupMutation = useMutation(convexApi.groups.create);
  const assignFirstUngroupedMutation = useMutation(
    convexApi.groups.assignFirstUngrouped,
  );
  const recordCaptureMutation = useMutation(convexApi.captures.record);

  const value = React.useMemo<AppDataContextValue>(
    () => ({
      products: products ?? [],
      session,
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
      seedSampleProducts: () => seedSampleProductsMutation(queryArgs),
      updateProduct: (args) =>
        updateProductMutation({ ...args, sessionToken: session.sessionToken }),
      setDuplicatePolicy: (duplicatePolicy) =>
        setDuplicatePolicyMutation({
          duplicatePolicy,
          sessionToken: session.sessionToken,
        }),
      disconnectShopify: () => disconnectShopifyMutation(queryArgs),
      createGroup: (name) =>
        createGroupMutation({ name, sessionToken: session.sessionToken }),
      assignFirstUngrouped: (groupId, count) =>
        assignFirstUngroupedMutation({
          groupId,
          count,
          sessionToken: session.sessionToken,
        }),
      recordCapture: (args) =>
        recordCaptureMutation({ ...args, sessionToken: session.sessionToken }),
    }),
    [
      assignFirstUngroupedMutation,
      createGroupMutation,
      groups,
      listingJobs,
      products,
      queryArgs,
      recordCaptureMutation,
      seedSampleProductsMutation,
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
