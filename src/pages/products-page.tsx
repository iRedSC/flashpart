import * as React from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  FolderPlus,
  MoreVertical,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
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
import { Switch } from "../components/ui/switch";
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
type CsvProduct = {
  sku: string;
  name: string;
  price: number;
};
type ExistingEntryBehavior = "overwrite" | "ignore";
type ImportResult = {
  ignored: number;
  inserted: number;
  overwritten: number;
};

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

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseProductCsv(text: string) {
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);

  if (rows.length === 0) {
    return {
      error: "Choose a CSV file with sku, name, and price columns.",
      products: [] as CsvProduct[],
      skippedRows: 0,
    };
  }

  const header = rows[0].map((value) => value.toLowerCase());
  const hasHeader = header.includes("sku") && header.includes("name") && header.includes("price");
  const skuIndex = hasHeader ? header.indexOf("sku") : 0;
  const nameIndex = hasHeader ? header.indexOf("name") : 1;
  const priceIndex = hasHeader ? header.indexOf("price") : 2;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const products: CsvProduct[] = [];
  let skippedRows = 0;

  for (const row of dataRows) {
    const sku = row[skuIndex]?.trim() ?? "";
    const name = row[nameIndex]?.trim() ?? "";
    const rawPrice = row[priceIndex]?.replace(/[$,]/g, "").trim() ?? "";
    const price = Number.parseFloat(rawPrice);

    if (!sku || !name || !Number.isFinite(price)) {
      skippedRows += 1;
      continue;
    }

    products.push({ name, price, sku });
  }

  return {
    error:
      products.length === 0
        ? "No valid products found. Use columns: sku, name, price."
        : null,
    products,
    skippedRows,
  };
}

export function ProductsPage() {
  const {
    assignProductsToGroup,
    deleteProducts,
    groups,
    isProductPending,
    isLoading,
    products,
    importProducts,
    publishProducts,
    updateProduct,
  } = useAppData();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const cardListRef = React.useRef<HTMLDivElement>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [addToGroupOpen, setAddToGroupOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importMode, setImportMode] =
    React.useState<ExistingEntryBehavior>("ignore");
  const [importSkuPrefix, setImportSkuPrefix] = React.useState("");
  const [importFileName, setImportFileName] = React.useState("");
  const [importRows, setImportRows] = React.useState<CsvProduct[]>([]);
  const [importSkippedRows, setImportSkippedRows] = React.useState(0);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [importResult, setImportResult] = React.useState<ImportResult | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
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
  const cardVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 124,
    getScrollElement: () => cardListRef.current,
    overscan: 8,
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

  function resetImportDialog() {
    setImportMode("ignore");
    setImportSkuPrefix("");
    setImportFileName("");
    setImportRows([]);
    setImportSkippedRows(0);
    setImportError(null);
    setImportResult(null);
    setIsImporting(false);
  }

  async function handleImportFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0];

    setImportResult(null);

    if (!file) {
      setImportFileName("");
      setImportRows([]);
      setImportSkippedRows(0);
      setImportError(null);
      return;
    }

    try {
      const parsed = parseProductCsv(await file.text());

      setImportFileName(file.name);
      setImportRows(parsed.products);
      setImportSkippedRows(parsed.skippedRows);
      setImportError(parsed.error);
    } catch {
      setImportFileName(file.name);
      setImportRows([]);
      setImportSkippedRows(0);
      setImportError("The CSV file could not be read.");
    }
  }

  async function handleImportProducts() {
    if (importRows.length === 0) {
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const skuPrefix = importSkuPrefix.trim();
      const result = await importProducts({
        existingEntryBehavior: importMode,
        products: importRows.map((product) => ({
          ...product,
          sku: skuPrefix ? `${skuPrefix}-${product.sku}` : product.sku,
        })),
      });

      if (result) {
        setImportResult(result);
      }
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Products could not be imported.",
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden md:overflow-visible">
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Button
            className="hidden text-slate-950 md:inline-flex"
            onClick={() => setImportOpen(true)}
            variant="outline"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          {hasSelection ? (
            <span>{selectedCount.toLocaleString()} selected</span>
          ) : null}
          {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
        </div>
        <div className="flex flex-nowrap gap-2">
          <Button
            className="px-3 md:px-4"
            disabled={!hasSelection}
            onClick={() => void handleDeleteSelected().catch(() => undefined)}
            variant="destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <Button
            className="px-3 md:px-4"
            disabled={!hasSelection}
            onClick={() => setAddToGroupOpen(true)}
            variant="outline"
          >
            <FolderPlus className="h-4 w-4" />
            Add to group
          </Button>
          <Button
            className="px-3 md:px-4"
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
          setImportOpen(open);
          if (!open) {
            resetImportDialog();
          }
        }}
        open={importOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import products</DialogTitle>
            <DialogDescription>
              Upload a CSV with sku, name, and price columns. Existing SKUs can be
              overwritten or ignored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="product-csv">
                CSV file
              </label>
              <Input
                accept=".csv,text/csv"
                id="product-csv"
                onChange={(event) =>
                  void handleImportFileChange(event).catch(() => undefined)
                }
                type="file"
              />
              <p className="text-xs text-slate-500">
                Header row is optional when columns are ordered as SKU, name, price.
              </p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="sku-prefix">
                Prefix
              </label>
              <Input
                id="sku-prefix"
                onChange={(event) => {
                  setImportSkuPrefix(event.currentTarget.value);
                  setImportResult(null);
                }}
                placeholder="PREFIX"
                value={importSkuPrefix}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <label className="text-sm font-medium" htmlFor="overwrite-existing">
                Overwrite existing product data
              </label>
              <Switch
                checked={importMode === "overwrite"}
                id="overwrite-existing"
                onCheckedChange={(checked) =>
                  setImportMode(checked ? "overwrite" : "ignore")
                }
              />
            </div>

            {importFileName ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p className="font-medium">{importFileName}</p>
                <p className="mt-1 text-slate-500">
                  {importRows.length.toLocaleString()} valid product
                  {importRows.length === 1 ? "" : "s"}
                  {importSkippedRows > 0
                    ? `, ${importSkippedRows.toLocaleString()} row${
                        importSkippedRows === 1 ? "" : "s"
                      } skipped`
                    : ""}
                </p>
              </div>
            ) : null}

            {importError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {importError}
              </p>
            ) : null}

            {importResult ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Imported {importResult.inserted.toLocaleString()} new, overwrote{" "}
                {importResult.overwritten.toLocaleString()}, ignored{" "}
                {importResult.ignored.toLocaleString()}.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setImportOpen(false)} variant="outline">
              Close
            </Button>
            <Button
              disabled={importRows.length === 0 || isImporting}
              onClick={() => void handleImportProducts().catch(() => undefined)}
            >
              {isImporting ? "Importing..." : "Import products"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:hidden"
        ref={cardListRef}
      >
        <div
          className="relative"
          style={{ height: `${cardVirtualizer.getTotalSize()}px` }}
        >
          {cardVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const product = row.original;

            return (
              <div
                className="absolute left-0 top-0 w-full pb-2"
                data-index={virtualRow.index}
                key={row.id}
                ref={cardVirtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className={cn(
                    "rounded-xl border border-slate-200 bg-white p-3 shadow-sm",
                    row.getIsSelected() && "border-slate-950",
                    isProductPending(product._id) && "bg-amber-50/70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      aria-label={`Select ${product.sku}`}
                      checked={row.getIsSelected()}
                      className="mt-1"
                      onCheckedChange={(value) => row.toggleSelected(!!value)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {product.name}
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {product.sku}
                      </p>
                    </div>
                    <span className="text-sm font-medium">
                      ${product.price.toFixed(2)}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={`Actions for ${product.sku}`}
                          className="-mr-1 -mt-1 h-8 w-8 shrink-0 p-0"
                          variant="ghost"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setRowSelection({ [product._id]: true });
                            setAddToGroupOpen(true);
                          }}
                        >
                          <FolderPlus />
                          Add to group
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void publishProducts([product._id]).catch(
                              () => undefined,
                            )
                          }
                        >
                          <Send />
                          Publish
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 focus:bg-red-50 focus:text-red-600"
                          onSelect={() =>
                            void deleteProducts([product._id]).catch(
                              () => undefined,
                            )
                          }
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <Badge variant={statusTone[product.status]}>
                      {product.status}
                    </Badge>
                    {isProductPending(product._id) ? (
                      <Badge
                        className="border-amber-300 text-amber-800"
                        variant="outline"
                      >
                        saving
                      </Badge>
                    ) : null}
                    <span>
                      {product.groupId
                        ? groupById.get(product.groupId) ?? "Assigned"
                        : "Ungrouped"}
                    </span>
                    <span className="font-mono">
                      {product.shopifyProductId ?? "Draft pending"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="hidden h-[560px] overflow-auto rounded-md border border-slate-200 md:block"
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
