import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Product = FunctionReturnType<typeof api.products.list>[number];
type Group = FunctionReturnType<typeof api.groups.list>[number];
type ListingJob = FunctionReturnType<typeof api.listingJobs.list>[number];

type AppDataContextValue = {
  products: Product[];
  groups: Group[];
  listingJobs: ListingJob[];
  isLoading: boolean;
  seedSampleProducts: () => Promise<{ inserted: number } | null>;
  updateProduct: (args: {
    id: Id<"products">;
    sku?: string;
    name?: string;
    price?: number;
    duplicatePolicy?: "blockExisting" | "updateExisting";
  }) => Promise<null>;
  setDuplicatePolicyForAll: (
    duplicatePolicy: "blockExisting" | "updateExisting",
  ) => Promise<{ updated: number } | null>;
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
  const seedSampleProductsMutation = useMutation(api.products.seedSampleProducts);
  const updateProductMutation = useMutation(api.products.update);
  const setDuplicatePolicyForAllMutation = useMutation(
    api.products.setDuplicatePolicyForAll,
  );
  const createGroupMutation = useMutation(api.groups.create);
  const assignFirstUngroupedMutation = useMutation(api.groups.assignFirstUngrouped);
  const recordCaptureMutation = useMutation(api.captures.record);

  const value = React.useMemo<AppDataContextValue>(
    () => ({
      products: products ?? [],
      groups: groups ?? [],
      listingJobs: listingJobs ?? [],
      isLoading: products === undefined || groups === undefined || listingJobs === undefined,
      seedSampleProducts: () => seedSampleProductsMutation({}),
      updateProduct: (args) => updateProductMutation(args),
      setDuplicatePolicyForAll: (duplicatePolicy) =>
        setDuplicatePolicyForAllMutation({ duplicatePolicy }),
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
      setDuplicatePolicyForAllMutation,
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
