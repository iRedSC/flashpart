import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  Camera,
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
import { DescriptionField } from "../components/description-field";
import { ProductRowActionItems } from "../components/product-row-actions";
import {
  ProductStatusIcons,
} from "../components/product-status-badge";
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
import { createCaptureSelection } from "../lib/capture-selection";
import { cn } from "../lib/utils";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];
type CsvProduct = {
  sku: string;
  name: string;
  price: number;
  description?: string;
};
type ExistingEntryBehavior = "overwrite" | "ignore";
type ImportResult = {
  ignored: number;
  inserted: number;
  overwritten: number;
};

const UNGROUPED_FILTER = "ungrouped";
const desktopGridColumns =
  "grid-cols-[36px_48px_132px_minmax(200px,320px)_minmax(180px,280px)_96px_88px_minmax(110px,160px)_minmax(190px,280px)]";
const desktopTableMinWidth = 1320;
const desktopRowHeight = 58;
const desktopTableInputClass = "h-8 min-w-0 w-full px-1.5";
const desktopCellClass =
  "flex min-w-0 items-center overflow-hidden px-4 py-0";
const desktopEditableCellClass =
  "flex min-w-0 w-full items-center overflow-hidden px-2 py-0";
const desktopHeadClass =
  "flex items-center px-4 text-[11px] font-medium uppercase tracking-wide text-slate-500";
const desktopEditableHeadClass =
  "flex items-center px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500";

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
  isSelected,
  label,
  listeners,
}: {
  attributes: ReturnType<typeof useDraggable>["attributes"];
  className?: string;
  iconClassName?: string;
  isSelected?: boolean;
  label: string;
  listeners: ReturnType<typeof useDraggable>["listeners"];
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md border-none bg-transparent p-0 text-slate-400 opacity-35 transition-opacity hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing group-hover:opacity-100",
        isSelected && "opacity-100",
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
  onOpenContextMenu,
  row,
  shiftY,
  virtualRow,
}: {
  dragActive: boolean;
  isDragSource: boolean;
  isPending: boolean;
  onOpenContextMenu: (product: Product, x: number, y: number) => void;
  row: Row<Product>;
  shiftY: number;
  virtualRow: VirtualItem;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: row.id });
  const isSelected = row.getIsSelected();

  return (
    <TableRow
      className={cn(
        "group absolute left-0 grid w-full border-b border-slate-100 bg-white transition-[background,box-shadow] duration-150 hover:bg-slate-50 hover:shadow-[inset_3px_0_0_#020617]",
        desktopGridColumns,
        isSelected && "bg-slate-50 shadow-[inset_3px_0_0_#020617]",
        isPending && "bg-amber-50/65 shadow-[inset_3px_0_0_#fcd34d]",
        isDragSource && "opacity-0",
      )}
      data-index={virtualRow.index}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu(row.original, event.clientX, event.clientY);
      }}
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
      <TableCell className="flex items-center justify-center px-2 py-0">
        <DragHandle
          attributes={attributes}
          isSelected={isSelected}
          label={`Reorder ${row.original.sku}`}
          listeners={listeners}
        />
      </TableCell>
      {row.getVisibleCells().map((cell) => (
        <TableCell
          className={cn(
            cell.column.id === "sku" ||
              cell.column.id === "name" ||
              cell.column.id === "description" ||
              cell.column.id === "price"
              ? desktopEditableCellClass
              : desktopCellClass,
            cell.column.id === "select" && "justify-center px-2",
            cell.column.id === "price" && "justify-end",
          )}
          key={cell.id}
        >
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
            <ProductStatusIcons
              lastError={product.lastError}
              needsPhotoReview={product.needsPhotoReview}
              pendingOperation={product.pendingOperation}
              phase={product.phase}
              saving={isPending}
            />
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
                <ProductRowActionItems
                  onAddToGroup={() => onAddToGroup(product)}
                  onDelete={() => onDelete(product)}
                  onDeleteShopifyFile={() => onDeleteShopifyFile(product)}
                  onPublish={() => onPublish(product)}
                  product={product}
                />
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
  const descriptionIndex = hasHeader ? header.indexOf("description") : -1;
  const hasDescriptionColumn = descriptionIndex >= 0;
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

    const product: CsvProduct = { name, price, sku };

    if (hasDescriptionColumn) {
      const description = row[descriptionIndex]?.trim() ?? "";
      if (description) {
        product.description = description;
      }
    }

    products.push(product);
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
    createGroup,
    createProduct,
    deleteProducts,
    deleteShopifyFile,
    groups,
    isProductPending,
    isLoading,
    products,
    importProducts,
    publishProducts,
    reorderProducts,
    updateProduct,
  } = useAppData();
  const navigate = useNavigate();
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
  const [newGroupName, setNewGroupName] = React.useState("");
  const [isCreatingGroup, setIsCreatingGroup] = React.useState(false);
  const [photoProductId, setPhotoProductId] =
    React.useState<Id<"products"> | null>(null);
  const [activeDescriptionId, setActiveDescriptionId] =
    React.useState<Id<"products"> | null>(null);
  const [desktopRowMenu, setDesktopRowMenu] = React.useState<{
    product: Product;
    x: number;
    y: number;
  } | null>(null);
  const focusNextDescriptionRef = React.useRef<
    (currentId: Id<"products">) => void
  >(() => {});
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
            className={cn(desktopTableInputClass, "font-mono text-[13px]")}
            defaultValue={row.original.sku}
            title={row.original.sku}
            variant="ghost"
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
          <div className="flex min-w-0 w-full items-center gap-2.5">
            {row.original.shopifyFileUrl ? (
              <button
                aria-label={`View photo for ${row.original.sku}`}
                className="shrink-0 rounded-lg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                onClick={() => setPhotoProductId(row.original._id)}
                type="button"
              >
                <img
                  alt={`Photo for ${row.original.sku}`}
                  className="h-10 w-10 rounded-lg object-cover"
                  src={row.original.shopifyFileUrl}
                />
              </button>
            ) : (
              <div
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
              >
                <Image className="h-4 w-4" />
              </div>
            )}
            <Input
              aria-label={`Name for ${row.original.sku}`}
              className={cn(desktopTableInputClass, "min-w-0 flex-1")}
              defaultValue={row.original.name}
              title={row.original.name}
              variant="ghost"
              onBlur={(event) => {
                if (event.currentTarget.value !== row.original.name) {
                  void updateProduct({
                    id: row.original._id,
                    name: event.currentTarget.value,
                  }).catch(() => undefined);
                }
              }}
            />
          </div>
        ),
      }),
      columnHelper.display({
        id: "description",
        header: "Description",
        cell: ({ row }) => (
          <DescriptionField
            aria-label={`Description for ${row.original.sku}`}
            className="w-full"
            onNavigateNext={() =>
              focusNextDescriptionRef.current(row.original._id)
            }
            onOpenChange={(open) => {
              if (open) {
                setActiveDescriptionId(row.original._id);
                return;
              }

              if (activeDescriptionId === row.original._id) {
                setActiveDescriptionId(null);
              }
            }}
            onSave={(description) => {
              const current = row.original.description ?? "";

              if (description !== current) {
                void updateProduct({
                  description,
                  id: row.original._id,
                }).catch(() => undefined);
              }
            }}
            open={activeDescriptionId === row.original._id}
            value={row.original.description ?? ""}
          />
        ),
      }),
      columnHelper.accessor("price", {
        header: "Price",
        cell: ({ row }) => (
          <Input
            aria-label={`Price for ${row.original.sku}`}
            className={cn(
              desktopTableInputClass,
              "text-right tabular-nums",
            )}
            defaultValue={row.original.price.toFixed(2)}
            inputMode="decimal"
            variant="ghost"
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
      columnHelper.accessor("phase", {
        header: "Status",
        cell: ({ row }) => (
          <ProductStatusIcons
            lastError={row.original.lastError}
            needsPhotoReview={row.original.needsPhotoReview}
            pendingOperation={row.original.pendingOperation}
            phase={row.original.phase}
            saving={isProductPending(row.original._id)}
          />
        ),
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
              <ShopifyListingIcon
                shopifyProductId={row.original.shopifyProductId}
              />
              <div className="flex min-w-0 flex-col gap-px">
                {shopifyLabel ? (
                  <span
                    className="truncate font-mono text-xs"
                    title={shopifyLabel}
                  >
                    {shopifyLabel}
                  </span>
                ) : (
                  <span className="truncate text-xs text-slate-400">
                    Listing pending
                  </span>
                )}
                {row.original.shopifyFileStatus ? (
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                    file {row.original.shopifyFileStatus}
                  </span>
                ) : null}
              </div>
            </div>
          );
        },
      }),
    ],
    [activeDescriptionId, groupById, isProductPending, updateProduct],
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

  React.useEffect(() => {
    focusNextDescriptionRef.current = (currentId) => {
      const index = rows.findIndex((row) => row.original._id === currentId);

      if (index === -1 || index >= rows.length - 1) {
        setActiveDescriptionId(null);
        return;
      }

      const nextIndex = index + 1;
      rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
      window.requestAnimationFrame(() => {
        setActiveDescriptionId(rows[nextIndex].original._id);
      });
    };
  }, [rows, rowVirtualizer]);
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
    setNewGroupName("");
    clearSelection();
  }

  async function handleCreateGroupInModal() {
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      return;
    }

    setIsCreatingGroup(true);

    try {
      const groupId = await createGroup(trimmed);
      setSelectedGroupId(groupId);
      setNewGroupName("");
    } catch {
      // The shared data provider reports the error and reverts optimistic state.
    } finally {
      setIsCreatingGroup(false);
    }
  }

  async function handlePublishSelected() {
    if (selectedProductIds.length === 0) {
      return;
    }

    await publishProducts(selectedProductIds);
    clearSelection();
  }

  async function handleCaptureSelected() {
    if (selectedProductIds.length === 0) {
      return;
    }

    const needsCaptureGroup = selectedRows.some((row) => !row.original.groupId);
    let captureGroupId: Id<"groups"> | undefined;

    if (needsCaptureGroup) {
      captureGroupId = await createGroup("Selected capture");
    }

    const selectionId = createCaptureSelection({
      captureGroupId,
      label: `${selectedCount.toLocaleString()} selected`,
      productIds: selectedProductIds,
    });

    clearSelection();
    navigate(`/capture/selection/${selectionId}`);
  }

  function openDesktopRowMenu(product: Product, x: number, y: number) {
    setDesktopRowMenu({ product, x, y });
  }

  function openAddToGroupForProduct(product: Product) {
    setRowSelection({ [product._id]: true });
    setAddToGroupOpen(true);
  }

  function handleDeleteShopifyFileForProduct(product: Product) {
    const confirmed =
      product.shopifyStatus === "published"
        ? window.confirm(
            "This product is published. Delete its Shopify photo anyway?",
          )
        : true;

    if (!confirmed) {
      return;
    }

    void deleteShopifyFile(
      product._id,
      product.shopifyStatus === "published",
    ).catch(() => undefined);
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
      <div className="flex shrink-0 items-center justify-between gap-2 md:gap-4">
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
                void handleCaptureSelected().catch(() => undefined)
              }
            >
              <Camera />
              Capture photos
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
              Upload a CSV with sku, name, and price columns. Description is
              optional when a description column is present. Existing SKUs can be
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
                Header row is optional when columns are ordered as SKU, name,
                price. Add an optional description column when needed.
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
            setNewGroupName("");
            setIsCreatingGroup(false);
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
          {groups.length > 0 ? (
            <div className="grid max-h-56 gap-2 overflow-y-auto">
              {groups.map((group) => (
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
              ))}
            </div>
          ) : null}
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateGroupInModal().catch(() => undefined);
            }}
          >
            <p className="text-sm font-medium text-slate-950">
              {groups.length === 0 ? "Create a group" : "Or create a new group"}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="New group name"
                onChange={(event) => setNewGroupName(event.currentTarget.value)}
                placeholder="Example: Makita brushes, bin A4"
                value={newGroupName}
              />
              <Button
                className="shrink-0"
                disabled={!newGroupName.trim() || isCreatingGroup}
                type="submit"
                variant="outline"
              >
                {isCreatingGroup ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
          <DialogFooter>
            <Button onClick={() => setAddToGroupOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!selectedGroupId}
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
                  measureElement={cardVirtualizer.measureElement}
                  onAddToGroup={(target) => {
                    setRowSelection({ [target._id]: true });
                    setAddToGroupOpen(true);
                  }}
                  onDelete={(target) =>
                    void deleteProducts([target._id]).catch(() => undefined)
                  }
                  onDeleteShopifyFile={handleDeleteShopifyFileForProduct}
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
                  <ProductStatusIcons
                    lastError={activeDragProduct.lastError}
                    needsPhotoReview={activeDragProduct.needsPhotoReview}
                    pendingOperation={activeDragProduct.pendingOperation}
                    phase={activeDragProduct.phase}
                    saving={isProductPending(activeDragProduct._id)}
                  />
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

      <div className="relative hidden min-h-0 flex-1 md:flex md:min-h-0 md:flex-col">
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
          <div className="relative left-1/2 flex min-h-0 w-[100vw] max-w-[100vw] flex-1 -translate-x-1/2 flex-col">
            <div className="mx-auto flex min-h-0 w-full max-w-[min(100vw,90rem)] flex-1 flex-col px-4 md:px-6">
              <div
                className="min-h-0 flex-1 basis-0 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm"
                ref={parentRef}
              >
                <table
                  className="grid w-full text-sm"
                  style={{ minWidth: `${desktopTableMinWidth}px` }}
                >
                <TableHeader className="sticky top-0 z-10 grid bg-slate-50">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow
                      className={cn(
                        "grid border-b border-slate-200 hover:bg-slate-50",
                        desktopGridColumns,
                      )}
                      key={headerGroup.id}
                    >
                      <TableHead aria-hidden className="px-2" />
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          className={cn(
                            header.column.id === "sku" ||
                              header.column.id === "name" ||
                              header.column.id === "description" ||
                              header.column.id === "price"
                              ? desktopEditableHeadClass
                              : desktopHeadClass,
                            header.column.id === "select" && "justify-center px-2",
                            header.column.id === "price" && "justify-end",
                          )}
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
                    onOpenContextMenu={openDesktopRowMenu}
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
            </div>
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
                  <div
                    className={cn(
                      cell.column.id === "sku" ||
                        cell.column.id === "name" ||
                        cell.column.id === "description" ||
                        cell.column.id === "price"
                        ? desktopEditableCellClass
                        : desktopCellClass,
                      cell.column.id === "select" && "justify-center px-2",
                      cell.column.id === "price" && "justify-end",
                    )}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) {
            setDesktopRowMenu(null);
          }
        }}
        open={desktopRowMenu !== null}
      >
        {desktopRowMenu ? (
          <DropdownMenuTrigger asChild>
            <span
              className="pointer-events-none fixed h-0 w-0"
              style={{
                left: desktopRowMenu.x,
                top: desktopRowMenu.y,
              }}
            />
          </DropdownMenuTrigger>
        ) : null}
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {desktopRowMenu ? (
            <ProductRowActionItems
              onAddToGroup={() => openAddToGroupForProduct(desktopRowMenu.product)}
              onDelete={() =>
                void deleteProducts([desktopRowMenu.product._id]).catch(
                  () => undefined,
                )
              }
              onDeleteShopifyFile={() =>
                handleDeleteShopifyFileForProduct(desktopRowMenu.product)
              }
              onPublish={() =>
                void publishProducts([desktopRowMenu.product._id]).catch(
                  () => undefined,
                )
              }
              product={desktopRowMenu.product}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
