import * as React from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderPlus, RefreshCw, Send, Trash2 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useAppData } from "../data/app-data-provider";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];

const columnHelper = createColumnHelper<Product>();
const statusTone: Record<Product["status"], "default" | "secondary" | "destructive" | "outline"> = {
  imported: "secondary",
  grouped: "default",
  captured: "outline",
  processing: "outline",
  draftCreated: "default",
  failed: "destructive",
  blockedExistingSku: "destructive",
  needsReview: "outline",
};

export function ProductsPage() {
  const {
    assignProductsToGroup,
    deleteProducts,
    groups,
    isProductPending,
    isLoading,
    products,
    publishProducts,
    updateProduct,
  } = useAppData();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [addToGroupOpen, setAddToGroupOpen] = React.useState(false);
  const [selectedGroupId, setSelectedGroupId] = React.useState<Id<"groups"> | "">("");
  const groupById = React.useMemo(
    () => new Map(groups.map((group) => [group._id, group.name])),
    [groups],
  );
  const columns = React.useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all products"
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.sku}`}
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
          />
        ),
      }),
      columnHelper.accessor("sku", {
        header: "SKU",
        cell: ({ row }) => (
          <Input
            aria-label={`SKU for ${row.original.name}`}
            className="h-8 font-mono"
            defaultValue={row.original.sku}
            onBlur={(event) => {
              if (event.currentTarget.value !== row.original.sku) {
                void updateProduct({
                  id: row.original._id,
                  sku: event.currentTarget.value,
                }).catch(() => undefined);
              }
            }}
          />
        ),
      }),
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ row }) => (
          <Input
            aria-label={`Name for ${row.original.sku}`}
            className="h-8"
            defaultValue={row.original.name}
            onBlur={(event) => {
              if (event.currentTarget.value !== row.original.name) {
                void updateProduct({
                  id: row.original._id,
                  name: event.currentTarget.value,
                }).catch(() => undefined);
              }
            }}
          />
        ),
      }),
      columnHelper.accessor("price", {
        header: "Price",
        cell: ({ row }) => (
          <Input
            aria-label={`Price for ${row.original.sku}`}
            className="h-8"
            defaultValue={row.original.price.toFixed(2)}
            inputMode="decimal"
            onBlur={(event) => {
              const price = Number.parseFloat(event.currentTarget.value);

              if (Number.isFinite(price) && price !== row.original.price) {
                void updateProduct({
                  id: row.original._id,
                  price,
                }).catch(() => undefined);
              }
            }}
          />
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <Badge variant={statusTone[row.original.status]}>
              {row.original.status}
            </Badge>
            {isProductPending(row.original._id) ? (
              <Badge className="border-amber-300 text-amber-800" variant="outline">
                saving
              </Badge>
            ) : null}
          </div>
        ),
      }),
      columnHelper.display({
        id: "group",
        header: "Group",
        cell: ({ row }) =>
          row.original.groupId ? (
            groupById.get(row.original.groupId) ?? "Assigned"
          ) : (
            <span className="text-slate-400">Ungrouped</span>
          ),
      }),
      columnHelper.display({
        id: "shopify",
        header: "Shopify",
        cell: ({ row }) =>
          row.original.shopifyProductId ? (
            <span className="font-mono text-xs">{row.original.shopifyProductId}</span>
          ) : (
            <span className="text-slate-400">Draft pending</span>
          ),
      }),
    ],
    [groupById, isProductPending, updateProduct],
  );
  const table = useReactTable({
    columns,
    data: products,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row._id,
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
  });
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 58,
    getScrollElement: () => parentRef.current,
    overscan: 12,
  });
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;
  const selectedProductIds = selectedRows.map((row) => row.original._id);
  const hasSelection = selectedCount > 0;

  function clearSelection() {
    setRowSelection({});
  }

  async function handleDeleteSelected() {
    if (selectedProductIds.length === 0) {
      return;
    }

    await deleteProducts(selectedProductIds);
    clearSelection();
  }

  async function handleAddToGroup() {
    if (!selectedGroupId || selectedProductIds.length === 0) {
      return;
    }

    await assignProductsToGroup(selectedGroupId, selectedProductIds);
    setAddToGroupOpen(false);
    setSelectedGroupId("");
    clearSelection();
  }

  async function handlePublishSelected() {
    if (selectedProductIds.length === 0) {
      return;
    }

    await publishProducts(selectedProductIds);
    clearSelection();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          {hasSelection ? (
            <span>{selectedCount.toLocaleString()} selected</span>
          ) : null}
          {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!hasSelection}
            onClick={() => void handleDeleteSelected().catch(() => undefined)}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <Button
            disabled={!hasSelection}
            onClick={() => setAddToGroupOpen(true)}
            variant="outline"
          >
            <FolderPlus className="h-4 w-4" />
            Add to group
          </Button>
          <Button
            disabled={!hasSelection}
            onClick={() => void handlePublishSelected().catch(() => undefined)}
          >
            <Send className="h-4 w-4" />
            Publish
          </Button>
        </div>
      </div>

      <Dialog
        onOpenChange={(open) => {
          setAddToGroupOpen(open);
          if (!open) {
            setSelectedGroupId("");
          }
        }}
        open={addToGroupOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to group</DialogTitle>
            <DialogDescription>
              Assign {selectedCount.toLocaleString()} selected product
              {selectedCount === 1 ? "" : "s"} to a group.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500">
                No groups yet. Create one on the Groups page first.
              </p>
            ) : (
              groups.map((group) => (
                <button
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                    selectedGroupId === group._id
                      ? "border-slate-950 bg-slate-50"
                      : "border-slate-200 hover:bg-slate-50",
                  )}
                  key={group._id}
                  onClick={() => setSelectedGroupId(group._id)}
                  type="button"
                >
                  <span className="font-medium">{group.name}</span>
                  <span className="mt-1 block text-slate-500">
                    {group.productCount.toLocaleString()} products
                  </span>
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setAddToGroupOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!selectedGroupId || groups.length === 0}
              onClick={() => void handleAddToGroup().catch(() => undefined)}
            >
              Add to group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className="h-[560px] overflow-auto rounded-md border border-slate-200"
        ref={parentRef}
      >
        <table className="grid w-full min-w-[1040px] text-sm">
          <TableHeader className="sticky top-0 z-10 grid bg-white">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                className="grid grid-cols-[48px_170px_1.5fr_140px_150px_160px_170px]"
                key={headerGroup.id}
              >
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            className="relative grid"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];

              return (
                <TableRow
                  className={cn(
                    "absolute left-0 grid w-full grid-cols-[48px_170px_1.5fr_140px_150px_160px_170px]",
                    virtualRow.index % 2 === 0 && "bg-slate-50/50",
                    isProductPending(row.original._id) && "bg-amber-50/70",
                  )}
                  data-index={virtualRow.index}
                  key={row.id}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </table>
      </div>
    </div>
  );
}
