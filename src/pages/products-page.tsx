import * as React from "react";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  getClientRect,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragMoveEvent,
  type DragStartEvent,
  type MeasuringConfiguration,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { arrayMove } from "@dnd-kit/sortable";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Row,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import {
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  Check,
  FilePenLine,
  FolderPlus,
  Globe,
  GripVertical,
  Image,
  ListFilter,
  MoreVertical,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { ProductStatusBadge } from "../components/product-status-badge";
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
import { ProductPhotoDialog } from "../components/product-photo-dialog";
import { useAppData } from "../data/app-data-provider";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];
type ListingJob = ReturnType<typeof useAppData>["listingJobs"][number];
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

const UNGROUPED_FILTER = "ungrouped";
const desktopGridColumns =
  "grid-cols-[36px_48px_180px_minmax(240px,1.6fr)_120px_160px_minmax(150px,1fr)_minmax(220px,1.2fr)]";
const desktopRowHeight = 58;
const desktopCellClass =
  "flex min-w-0 items-center overflow-hidden px-4 py-0";

const columnHelper = createColumnHelper<Product>();

// By default dnd-kit ignores an element's own CSS transform when measuring
// it, but the virtualizer positions rows entirely with transforms, so the
// default measurement would place every row at the top of the list.
const dndMeasuring: MeasuringConfiguration = {
  draggable: { measure: getClientRect },
};

// How far rows around the drag source slide aside to preview the drop slot.
function getDropShift({
  activeIndex,
  activeSize,
  index,
  projectedIndex,
}: {
  activeIndex: number;
  activeSize: number;
  index: number;
  projectedIndex: number | null;
}) {
  if (activeIndex < 0 || projectedIndex === null || index === activeIndex) {
    return 0;
  }

  if (
    activeIndex < projectedIndex &&
    index > activeIndex &&
    index <= projectedIndex
  ) {
    return -activeSize;
  }

  if (
    activeIndex > projectedIndex &&
    index >= projectedIndex &&
    index < activeIndex
  ) {
    return activeSize;
  }

  return 0;
}

function DragHandle({
  attributes,
  className,
  iconClassName,
  label,
  listeners,
}: {
  attributes: ReturnType<typeof useDraggable>["attributes"];
  className?: string;
  iconClassName?: string;
  label: string;
  listeners: ReturnType<typeof useDraggable>["listeners"];
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "cursor-grab touch-none rounded p-1 text-slate-400 transition-colors hover:text-slate-950 active:cursor-grabbing",
        className,
      )}
      type="button"
      {...attributes}
      {...listeners}
    >
      <GripVertical className={cn("h-4 w-4", iconClassName)} />
    </button>
  );
}

function DesktopProductRow({
  dragActive,
  isDragSource,
  isPending,
  row,
  shiftY,
  virtualRow,
}: {
  dragActive: boolean;
  isDragSource: boolean;
  isPending: boolean;
  row: Row<Product>;
  shiftY: number;
  virtualRow: VirtualItem;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: row.id });

  return (
    <TableRow
      className={cn(
        "absolute left-0 grid w-full",
        desktopGridColumns,
        virtualRow.index % 2 === 0 && "bg-slate-50/50",
        isPending && "bg-amber-50/70",
        isDragSource && "opacity-0",
      )}
      data-index={virtualRow.index}
      ref={setNodeRef}
      style={{
        height: `${desktopRowHeight}px`,
        transform: `translateY(${virtualRow.start}px)`,
        // `translate` composes with `transform`, so the drop-preview shift can
        // animate independently of the virtualizer positioning.
        translate: `0 ${shiftY}px`,
        transition: dragActive ? "translate 200ms ease" : undefined,
      }}
    >
      <TableCell className="flex items-center px-2 py-0">
        <DragHandle
          attributes={attributes}
          label={`Reorder ${row.original.sku}`}
          listeners={listeners}
        />
      </TableCell>
      {row.getVisibleCells().map((cell) => (
        <TableCell className={desktopCellClass} key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}

function ShopifyListingIcon({
  shopifyProductId,
}: {
  shopifyProductId?: string | null;
}) {
  if (shopifyProductId) {
    return (
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-green-100 text-green-600"
        title={`Published · ${shopifyProductId}`}
      >
        <Globe className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600"
      title="Draft pending"
    >
      <FilePenLine className="h-3.5 w-3.5" />
    </span>
  );
}

function MobileProductCard({
  dragActive,
  groupLabel,
  isDragSource,
  isPending,
  latestJob,
  measureElement,
  onAddToGroup,
  onDelete,
  onDeleteShopifyFile,
  onOpenPhoto,
  onPublish,
  row,
  shiftY,
  virtualRow,
}: {
  dragActive: boolean;
  groupLabel: string;
  isDragSource: boolean;
  isPending: boolean;
  latestJob: ListingJob | undefined;
  measureElement: (node: Element | null) => void;
  onAddToGroup: (product: Product) => void;
  onDelete: (product: Product) => void;
  onDeleteShopifyFile: (product: Product) => void;
  onOpenPhoto: (product: Product) => void;
  onPublish: (product: Product) => void;
  row: Row<Product>;
  shiftY: number;
  virtualRow: VirtualItem;
}) {
  const product = row.original;
  const { attributes, listeners, setNodeRef } = useDraggable({ id: row.id });

  return (
    <div
      className="absolute left-0 top-0 w-full pb-2"
      data-index={virtualRow.index}
      ref={measureElement}
      style={{
        transform: `translate3d(0, ${virtualRow.start}px, 0)`,
        // `translate` composes with `transform`, so the drop-preview shift can
        // animate independently of the virtualizer positioning.
        translate: `0 ${shiftY}px`,
        transition: dragActive ? "translate 200ms ease" : undefined,
      }}
    >
      <div
        className={cn(
          "cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 py-4 shadow-sm transition-opacity",
          row.getIsSelected() && "border-slate-950",
          isPending && "bg-amber-50/70",
          isDragSource && "opacity-0",
        )}
        ref={setNodeRef}
        onClick={(event) => {
          if (
            (event.target as HTMLElement).closest(
              "button, a, [role='button'], [role='checkbox'], input, label",
            )
          ) {
            return;
          }

          row.toggleSelected();
        }}
      >
        <div className="flex items-stretch gap-3.5">
          {product.shopifyFileUrl ? (
            <button
              aria-label={`View photo for ${product.sku}`}
              className="shrink-0 rounded-lg transition-transform active:scale-95"
              onClick={() => onOpenPhoto(product)}
              type="button"
            >
              <img
                alt={`Shopify file for ${product.sku}`}
                className="h-[52px] w-[52px] rounded-lg object-cover"
                src={product.shopifyFileUrl}
              />
            </button>
          ) : (
            <div
              aria-hidden="true"
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
            >
              <Image className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1 self-center pr-1">
            <p
              className="line-clamp-2 text-sm font-medium"
              title={product.name}
            >
              {product.name}
            </p>
            <p className="truncate font-mono text-xs text-slate-500">
              {product.sku}
            </p>
          </div>
          <DragHandle
            attributes={attributes}
            className="flex h-9 w-9 shrink-0 items-center justify-center self-center p-0"
            iconClassName="h-[18px] w-[18px]"
            label={`Reorder ${product.sku}`}
            listeners={listeners}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
            <ShopifyListingIcon shopifyProductId={product.shopifyProductId} />
            <ProductStatusBadge
              error={product.error}
              hasCapture={Boolean(product.shopifyFileId)}
              latestJob={latestJob}
              status={product.status}
            />
            {isPending ? (
              <Badge className="border-amber-300 text-amber-800" variant="outline">
                saving
              </Badge>
            ) : null}
            <span>{groupLabel}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="text-sm font-medium">
              ${product.price.toFixed(2)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${product.sku}`}
                  className="h-9 w-9 shrink-0 p-0"
                  variant="ghost"
                >
                  <MoreVertical className="h-[18px] w-[18px]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onAddToGroup(product)}>
                  <FolderPlus />
                  Add to group
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPublish(product)}>
                  <Send />
                  Publish
                </DropdownMenuItem>
                {product.shopifyFileId ? (
                  <DropdownMenuItem
                    onSelect={() => onDeleteShopifyFile(product)}
                  >
                    <Trash2 />
                    Delete Shopify photo
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  className="text-red-600 focus:bg-red-50 focus:text-red-600"
                  onSelect={() => onDelete(product)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Checkbox
              aria-label={`Select ${product.sku}`}
              checked={row.getIsSelected()}
              onCheckedChange={(value) => row.toggleSelected(!!value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
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
    createProduct,
    deleteProducts,
    deleteShopifyFile,
    groups,
    isProductPending,
    isLoading,
    listingJobs,
    products,
    importProducts,
    publishProducts,
    reorderProducts,
    updateProduct,
  } = useAppData();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const desktopBodyRef = React.useRef<HTMLTableSectionElement>(null);
  const cardListRef = React.useRef<HTMLDivElement>(null);
  const mobileListRef = React.useRef<HTMLDivElement>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const groupFilter = searchParams.get("group");
  const filteredProducts = React.useMemo(() => {
    if (!groupFilter) {
      return products;
    }

    if (groupFilter === UNGROUPED_FILTER) {
      return products.filter((product) => !product.groupId);
    }

    return products.filter((product) => product.groupId === groupFilter);
  }, [groupFilter, products]);
  const [activeDragProductId, setActiveDragProductId] =
    React.useState<Id<"products"> | null>(null);
  const [projectedIndex, setProjectedIndex] = React.useState<number | null>(
    null,
  );
  const activeCardSizeRef = React.useRef(136);
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );
  const [addToGroupOpen, setAddToGroupOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [addPartOpen, setAddPartOpen] = React.useState(false);
  const [addPartSku, setAddPartSku] = React.useState("");
  const [addPartName, setAddPartName] = React.useState("");
  const [addPartPrice, setAddPartPrice] = React.useState("");
  const [addPartError, setAddPartError] = React.useState<string | null>(null);
  const [isAddingPart, setIsAddingPart] = React.useState(false);
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
  const [photoProductId, setPhotoProductId] =
    React.useState<Id<"products"> | null>(null);
  const photoProduct = React.useMemo(
    () =>
      photoProductId
        ? products.find((product) => product._id === photoProductId) ?? null
        : null,
    [photoProductId, products],
  );
  const groupById = React.useMemo(
    () => new Map(groups.map((group) => [group._id, group.name])),
    [groups],
  );
  const latestJobByProductId = React.useMemo(() => {
    const map = new Map<Id<"products">, (typeof listingJobs)[number]>();

    for (const job of listingJobs) {
      const existing = map.get(job.productId);

      if (!existing || existing.createdAt < job.createdAt) {
        map.set(job.productId, job);
      }
    }

    return map;
  }, [listingJobs]);
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
            title={row.original.sku}
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
            title={row.original.name}
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
        cell: ({ row }) => {
          const latestJob = latestJobByProductId.get(row.original._id);

          return (
            <div className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
              <ProductStatusBadge
                error={row.original.error}
                hasCapture={Boolean(row.original.shopifyFileId)}
                latestJob={latestJob}
                status={row.original.status}
              />
              {isProductPending(row.original._id) ? (
                <Badge className="border-amber-300 text-amber-800" variant="outline">
                  saving
                </Badge>
              ) : null}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "group",
        header: "Group",
        cell: ({ row }) => {
          if (!row.original.groupId) {
            return <span className="truncate text-slate-400">Ungrouped</span>;
          }

          const groupName = groupById.get(row.original.groupId) ?? "Assigned";

          return (
            <span className="min-w-0 truncate" title={groupName}>
              {groupName}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: "shopify",
        header: "Shopify",
        cell: ({ row }) => {
          const shopifyLabel =
            row.original.shopifyProductHandle ?? row.original.shopifyProductId;

          return (
            <div className="flex w-full min-w-0 items-center gap-2">
              {row.original.shopifyFileUrl ? (
                <button
                  aria-label={`View photo for ${row.original.sku}`}
                  className="shrink-0 rounded transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                  onClick={() => setPhotoProductId(row.original._id)}
                  type="button"
                >
                  <img
                    alt={`Shopify file for ${row.original.sku}`}
                    className="h-8 w-8 rounded object-cover"
                    src={row.original.shopifyFileUrl}
                  />
                </button>
              ) : null}
              {shopifyLabel ? (
                <span
                  className="min-w-0 truncate font-mono text-xs"
                  title={shopifyLabel}
                >
                  {shopifyLabel}
                </span>
              ) : (
                <span className="truncate text-slate-400">Listing pending</span>
              )}
              {row.original.shopifyFileStatus ? (
                <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                  file {row.original.shopifyFileStatus}
                </span>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [groupById, isProductPending, latestJobByProductId, updateProduct],
  );
  const table = useReactTable({
    columns,
    data: filteredProducts,
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
    estimateSize: () => desktopRowHeight,
    getScrollElement: () => parentRef.current,
    overscan: 12,
  });
  const cardVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 136,
    getScrollElement: () => cardListRef.current,
    overscan: 8,
  });
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;
  const selectedProductIds = selectedRows.map((row) => row.original._id);
  const hasSelection = selectedCount > 0;
  const visibleIds = React.useMemo(
    () => filteredProducts.map((product) => product._id),
    [filteredProducts],
  );
  const activeFilterLabel = !groupFilter
    ? "All products"
    : groupFilter === UNGROUPED_FILTER
      ? "Ungrouped"
      : groupById.get(groupFilter as Id<"groups">) ?? "Group";
  const activeDragIndex = activeDragProductId
    ? visibleIds.indexOf(activeDragProductId)
    : -1;
  const activeDragRow = activeDragProductId
    ? rows.find((row) => row.id === activeDragProductId) ?? null
    : null;
  const activeDragProduct = activeDragRow?.original ?? null;
  const activeDragGroupLabel = activeDragProduct?.groupId
    ? groupById.get(activeDragProduct.groupId) ?? "Assigned"
    : "Ungrouped";

  function clearSelection() {
    setRowSelection({});
  }

  function setGroupFilter(value: string | null) {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);

        if (value) {
          next.set("group", value);
        } else {
          next.delete("group");
        }

        return next;
      },
      { replace: true },
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const activeId = event.active.id as Id<"products">;
    const activeIndex = visibleIds.indexOf(activeId);

    // Capture the dragged card's height once, while it is still rendered, so
    // the gap stays stable even if the source scrolls out of the viewport.
    activeCardSizeRef.current =
      cardVirtualizer
        .getVirtualItems()
        .find((item) => item.index === activeIndex)?.size ?? 136;
    setActiveDragProductId(activeId);
    setProjectedIndex(activeIndex);
  }

  // Hit-test the dragged item's center against the virtualizer's row
  // positions instead of dnd-kit droppables, which go stale in a virtualized
  // list as rows mount and unmount.
  function updateProjectedIndex(
    event: DragMoveEvent,
    listElement: HTMLElement | null,
    virtualizer: Virtualizer<HTMLDivElement, Element>,
  ) {
    const translated = event.active.rect.current.translated;

    if (!translated || !listElement) {
      return;
    }

    const centerY =
      translated.top +
      translated.height / 2 -
      listElement.getBoundingClientRect().top;
    let closestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const item of virtualizer.getVirtualItems()) {
      const distance = Math.abs(item.start + item.size / 2 - centerY);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = item.index;
      }
    }

    if (closestIndex !== null) {
      setProjectedIndex(closestIndex);
    }
  }

  function handleDragEnd() {
    const fromIndex = activeDragIndex;
    const toIndex = projectedIndex;

    setActiveDragProductId(null);
    setProjectedIndex(null);

    if (fromIndex < 0 || toIndex === null || toIndex === fromIndex) {
      return;
    }

    const nextVisibleIds = arrayMove(visibleIds, fromIndex, toIndex);

    // Re-thread the visible ordering through the global list so hidden
    // (filtered-out) products keep their positions.
    const visibleIdSet = new Set(visibleIds);
    let cursor = 0;
    const orderedIds = products.map((product) =>
      visibleIdSet.has(product._id) ? nextVisibleIds[cursor++] : product._id,
    );

    void reorderProducts(orderedIds).catch(() => undefined);
  }

  function handleDragCancel() {
    setActiveDragProductId(null);
    setProjectedIndex(null);
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

  function resetAddPartDialog() {
    setAddPartSku("");
    setAddPartName("");
    setAddPartPrice("");
    setAddPartError(null);
    setIsAddingPart(false);
  }

  async function handleAddPart() {
    const sku = addPartSku.trim();
    const name = addPartName.trim();
    const price = Number.parseFloat(addPartPrice);

    if (!sku || !name) {
      setAddPartError("SKU and name are required.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setAddPartError("Enter a valid price.");
      return;
    }

    setIsAddingPart(true);
    setAddPartError(null);

    try {
      await createProduct({ name, price, sku });
      setAddPartOpen(false);
      resetAddPartDialog();
    } catch (error) {
      setAddPartError(
        error instanceof Error ? error.message : "The product could not be added.",
      );
    } finally {
      setIsAddingPart(false);
    }
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
      <div className="flex items-center justify-between gap-2 md:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-500">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="max-w-56 px-3 text-slate-950 md:px-4"
                variant="outline"
              >
                <ListFilter className="h-4 w-4" />
                <span className="truncate">{activeFilterLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-72">
              <DropdownMenuItem onSelect={() => setGroupFilter(null)}>
                <span className="flex-1">All products</span>
                {!groupFilter ? <Check /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setGroupFilter(UNGROUPED_FILTER)}>
                <span className="flex-1">Ungrouped</span>
                {groupFilter === UNGROUPED_FILTER ? <Check /> : null}
              </DropdownMenuItem>
              {groups.map((group) => (
                <DropdownMenuItem
                  key={group._id}
                  onSelect={() => setGroupFilter(group._id)}
                >
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  {groupFilter === group._id ? <Check /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Button
              className="text-slate-950"
              onClick={() => setImportOpen(true)}
              variant="outline"
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button
              aria-label="Add part"
              className="h-9 w-9 shrink-0 p-0 text-slate-950"
              onClick={() => setAddPartOpen(true)}
              variant="outline"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Button
            aria-label="Add part"
            className="h-9 w-9 shrink-0 p-0 text-slate-950 md:hidden"
            onClick={() => setAddPartOpen(true)}
            variant="outline"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {hasSelection ? (
            <span className="shrink-0">
              {selectedCount.toLocaleString()} selected
            </span>
          ) : null}
          {isLoading ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Bulk actions"
              className="h-9 w-9 shrink-0 p-0"
              variant="outline"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!hasSelection}
              onSelect={() => setAddToGroupOpen(true)}
            >
              <FolderPlus />
              Add to group
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!hasSelection}
              onSelect={() =>
                void handlePublishSelected().catch(() => undefined)
              }
            >
              <Send />
              Publish
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-600 focus:bg-red-50 focus:text-red-600"
              disabled={!hasSelection}
              onSelect={() =>
                void handleDeleteSelected().catch(() => undefined)
              }
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          setAddPartOpen(open);
          if (!open) {
            resetAddPartDialog();
          }
        }}
        open={addPartOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add part</DialogTitle>
            <DialogDescription>
              Enter the SKU, name, and price for a new product.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="add-part-sku">
                SKU
              </label>
              <Input
                id="add-part-sku"
                onChange={(event) => {
                  setAddPartSku(event.currentTarget.value);
                  setAddPartError(null);
                }}
                placeholder="FP-1001"
                value={addPartSku}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="add-part-name">
                Name
              </label>
              <Input
                id="add-part-name"
                onChange={(event) => {
                  setAddPartName(event.currentTarget.value);
                  setAddPartError(null);
                }}
                placeholder="Drive Belt, 3/8 in."
                value={addPartName}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="add-part-price">
                Price
              </label>
              <Input
                id="add-part-price"
                inputMode="decimal"
                onChange={(event) => {
                  setAddPartPrice(event.currentTarget.value);
                  setAddPartError(null);
                }}
                placeholder="12.99"
                value={addPartPrice}
              />
            </div>
            {addPartError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {addPartError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setAddPartOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={isAddingPart}
              onClick={() => void handleAddPart().catch(() => undefined)}
            >
              {isAddingPart ? "Adding..." : "Add part"}
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

      <ProductPhotoDialog
        onClose={() => setPhotoProductId(null)}
        product={photoProduct}
      />

      <DndContext
        measuring={dndMeasuring}
        modifiers={[restrictToVerticalAxis]}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        onDragMove={(event) =>
          updateProjectedIndex(event, mobileListRef.current, cardVirtualizer)
        }
        onDragStart={handleDragStart}
        sensors={dndSensors}
      >
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:hidden"
          ref={cardListRef}
        >
          {!isLoading && rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {groupFilter
                ? "No products match this filter."
                : "No products yet."}
            </p>
          ) : null}
          <div
            className="relative"
            ref={mobileListRef}
            style={{ height: `${cardVirtualizer.getTotalSize()}px` }}
          >
            {cardVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const product = row.original;

              return (
                <MobileProductCard
                  dragActive={activeDragProductId !== null}
                  groupLabel={
                    product.groupId
                      ? groupById.get(product.groupId) ?? "Assigned"
                      : "Ungrouped"
                  }
                  isDragSource={product._id === activeDragProductId}
                  isPending={isProductPending(product._id)}
                  key={row.id}
                  latestJob={latestJobByProductId.get(product._id)}
                  measureElement={cardVirtualizer.measureElement}
                  onAddToGroup={(target) => {
                    setRowSelection({ [target._id]: true });
                    setAddToGroupOpen(true);
                  }}
                  onDelete={(target) =>
                    void deleteProducts([target._id]).catch(() => undefined)
                  }
                  onDeleteShopifyFile={(target) => {
                    const confirmed =
                      target.shopifyStatus === "published"
                        ? window.confirm(
                            "This product is published. Delete its Shopify photo anyway?",
                          )
                        : true;

                    if (!confirmed) {
                      return;
                    }

                    void deleteShopifyFile(
                      target._id,
                      target.shopifyStatus === "published",
                    ).catch(() => undefined);
                  }}
                  onOpenPhoto={(target) => setPhotoProductId(target._id)}
                  onPublish={(target) =>
                    void publishProducts([target._id]).catch(() => undefined)
                  }
                  row={row}
                  shiftY={getDropShift({
                    activeIndex: activeDragIndex,
                    activeSize: activeCardSizeRef.current,
                    index: virtualRow.index,
                    projectedIndex,
                  })}
                  virtualRow={virtualRow}
                />
              );
            })}
          </div>
        </div>
        <DragOverlay adjustScale={false} dropAnimation={null}>
          {activeDragProduct && activeDragRow ? (
            <div
              className={cn(
                "pointer-events-none relative mx-3 w-[calc(100%-1.5rem)] origin-center scale-[0.88] rounded-xl border border-slate-200 bg-white/75 px-3.5 py-4 shadow-lg backdrop-blur-sm",
                activeDragRow.getIsSelected() && "border-slate-950",
                isProductPending(activeDragProduct._id) && "bg-amber-50/70",
              )}
            >
              <div className="flex items-stretch gap-3.5">
                {activeDragProduct.shopifyFileUrl ? (
                  <img
                    alt=""
                    className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover"
                    src={activeDragProduct.shopifyFileUrl}
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
                  >
                    <Image className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1 self-center pr-1">
                  <p
                    className="line-clamp-2 text-sm font-medium"
                    title={activeDragProduct.name}
                  >
                    {activeDragProduct.name}
                  </p>
                  <p className="truncate font-mono text-xs text-slate-500">
                    {activeDragProduct.sku}
                  </p>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center self-center text-slate-400">
                  <GripVertical className="h-[18px] w-[18px]" />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
                  <ShopifyListingIcon
                    shopifyProductId={activeDragProduct.shopifyProductId}
                  />
                  <ProductStatusBadge
                    error={activeDragProduct.error}
                    hasCapture={Boolean(activeDragProduct.shopifyFileId)}
                    latestJob={latestJobByProductId.get(activeDragProduct._id)}
                    status={activeDragProduct.status}
                  />
                  {isProductPending(activeDragProduct._id) ? (
                    <Badge
                      className="border-amber-300 text-amber-800"
                      variant="outline"
                    >
                      saving
                    </Badge>
                  ) : null}
                  <span>{activeDragGroupLabel}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <span className="text-sm font-medium">
                    ${activeDragProduct.price.toFixed(2)}
                  </span>
                  <div className="flex h-9 w-9 items-center justify-center text-slate-500">
                    <MoreVertical className="h-[18px] w-[18px]" />
                  </div>
                  <Checkbox
                    aria-hidden="true"
                    checked={activeDragRow.getIsSelected()}
                    tabIndex={-1}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <DndContext
        measuring={dndMeasuring}
        modifiers={[restrictToVerticalAxis]}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        onDragMove={(event) =>
          updateProjectedIndex(event, desktopBodyRef.current, rowVirtualizer)
        }
        onDragStart={handleDragStart}
        sensors={dndSensors}
      >
        <div
          className="hidden h-[560px] overflow-auto rounded-md border border-slate-200 md:block"
          ref={parentRef}
        >
          <table className="grid w-full min-w-[1200px] text-sm">
            <TableHeader className="sticky top-0 z-10 grid bg-white">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  className={cn("grid", desktopGridColumns)}
                  key={headerGroup.id}
                >
                  <TableHead aria-hidden className="px-2" />
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      className="flex items-center whitespace-nowrap"
                      key={header.id}
                    >
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
              ref={desktopBodyRef}
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];

                return (
                  <DesktopProductRow
                    dragActive={activeDragProductId !== null}
                    isDragSource={row.original._id === activeDragProductId}
                    isPending={isProductPending(row.original._id)}
                    key={row.id}
                    row={row}
                    shiftY={getDropShift({
                      activeIndex: activeDragIndex,
                      activeSize: desktopRowHeight,
                      index: virtualRow.index,
                      projectedIndex,
                    })}
                    virtualRow={virtualRow}
                  />
                );
              })}
            </TableBody>
          </table>
          {!isLoading && rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {groupFilter
                ? "No products match this filter."
                : "No products yet."}
            </p>
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragRow ? (
            <div
              className={cn(
                "pointer-events-none relative grid h-full w-full rounded-md border border-slate-200 bg-white/75 text-sm shadow-lg backdrop-blur-sm",
                desktopGridColumns,
              )}
            >
              <div className="flex items-center px-2">
                <GripVertical className="h-4 w-4 text-slate-400" />
              </div>
              {activeDragRow.getVisibleCells().map((cell) => (
                <div className={desktopCellClass} key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
