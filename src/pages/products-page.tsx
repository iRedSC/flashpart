import * as React from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RefreshCw, Rows3 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

export function ProductsPage() {
  const {
    groups,
    isLoading,
    products,
    seedSampleProducts,
    setDuplicatePolicyForAll,
    updateProduct,
  } = useAppData();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const groupById = React.useMemo(
    () => new Map(groups.map((group) => [group._id, group.name])),
    [groups],
  );
  const columns = React.useMemo(
    () => [
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
                });
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
                });
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
                });
              }
            }}
          />
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={statusTone[row.original.status]}>
            {row.original.status}
          </Badge>
        ),
      }),
      columnHelper.accessor("duplicatePolicy", {
        header: "Existing SKU",
        cell: ({ row }) => (
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={row.original.duplicatePolicy}
            onChange={(event) => {
              void updateProduct({
                duplicatePolicy: event.currentTarget.value as Product["duplicatePolicy"],
                id: row.original._id,
              });
            }}
          >
            <option value="blockExisting">Block</option>
            <option value="updateExisting">Update</option>
          </select>
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
    [groupById, updateProduct],
  );
  const table = useReactTable({
    columns,
    data: products,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 58,
    getScrollElement: () => parentRef.current,
    overscan: 12,
  });
  const groupedCount = products.filter((product) => product.groupId).length;
  const totalValue = products.reduce((total, product) => total + product.price, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Products</h2>
          <p className="text-slate-500">
            All imported vendor rows. Edit SKU, name, price, and duplicate behavior.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void seedSampleProducts()} variant="outline">
            <Rows3 className="h-4 w-4" />
            Seed sample rows
          </Button>
          <Button
            onClick={() => void setDuplicatePolicyForAll("blockExisting")}
            variant="secondary"
          >
            Block existing SKUs
          </Button>
          <Button
            onClick={() => void setDuplicatePolicyForAll("updateExisting")}
            variant="secondary"
          >
            Update existing SKUs
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Products" value={products.length.toLocaleString()} />
        <SummaryCard label="Grouped" value={groupedCount.toLocaleString()} />
        <SummaryCard label="Imported value" value={formatCurrency(totalValue)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Product table
            {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          </CardTitle>
          <CardDescription>
            Virtualized rows keep the table responsive as imports grow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="h-[560px] overflow-auto rounded-md border border-slate-200"
            ref={parentRef}
          >
            <table className="grid w-full min-w-[1040px] text-sm">
              <TableHeader className="sticky top-0 z-10 grid bg-white">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    className="grid grid-cols-[170px_1.5fr_140px_150px_150px_160px_170px]"
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
                        "absolute left-0 grid w-full grid-cols-[170px_1.5fr_140px_150px_150px_160px_170px]",
                        virtualRow.index % 2 === 0 && "bg-slate-50/50",
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
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
