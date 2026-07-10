import * as React from "react";
import { useQuery } from "convex/react";
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
  Archive,
  ArchiveRestore,
  Camera,
  Check,
  FilePenLine,
  FolderPlus,
  Globe,
  GripVertical,
  ListFilter,
  Loader2,
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
  StatusIcon,
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
import { ProductThumbnail } from "../components/product-thumbnail";
import { useAppData } from "../data/app-data-provider";
import { createCaptureSelection } from "../lib/capture-selection";
import { convexApi } from "../lib/convex-api";
import {
  canPublishProduct,
  listOriginals,
  needsAiPhotoApproval,
  type ProductPhoto,
} from "../lib/product-photo";
import { canArchive, isArchived, isDuplicateSkuError, isGroupArchived, type LastError } from "../lib/product-state";
import { cn } from "../lib/utils";
import { normalizeTagString } from "../lib/tags";
import type { Id } from "../../convex/_generated/dataModel";

type Product = ReturnType<typeof useAppData>["products"][number];
type CsvProduct = {
  sku: string;
  name: string;
  price: number;
  description?: string;
  vendor?: string;
  tags?: string;
};
type ExistingEntryBehavior = "overwrite" | "ignore";
type ImportResult = {
  ignored: number;
  inserted: number;
  overwritten: number;
};

const UNGROUPED_FILTER = "ungrouped";
const VIEW_ACTIVE = "active";
const VIEW_ARCHIVED = "archived";
type ProductsView = typeof VIEW_ACTIVE | typeof VIEW_ARCHIVED;
const desktopGridColumns =
  "grid-cols-[36px_48px_132px_minmax(200px,320px)_minmax(180px,280px)_96px_minmax(110px,160px)_minmax(140px,200px)_88px_minmax(110px,160px)_minmax(190px,280px)]";
const desktopTableMinWidth = 1540;
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

type EditableColumnId =
  | "sku"
  | "name"
  | "description"
  | "price"
  | "vendor"
  | "tags";

function productCellSelector(
  productId: Id<"products">,
  columnId: EditableColumnId,
) {
  return `[data-product-cell="${productId}:${columnId}"]`;
}

function handleEditableInputEnter(
  event: React.KeyboardEvent<HTMLInputElement>,
  navigateNext: () => void,
) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  event.currentTarget.blur();
  navigateNext();
}

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
              cell.column.id === "price" ||
              cell.column.id === "vendor" ||
              cell.column.id === "tags"
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
      <StatusIcon
        icon={<Globe className="h-3.5 w-3.5" />}
        label={`Published · ${shopifyProductId}`}
        toneClass="bg-green-100 text-green-600"
      />
    );
  }

  return (
    <StatusIcon
      icon={<FilePenLine className="h-3.5 w-3.5" />}
      label="Draft pending"
      toneClass="bg-blue-100 text-blue-600"
    />
  );
}


function productNeedsPhotoReview(
  product: Product,
  photos?: ProductPhoto[] | null,
) {
  // undefined/null = batch still loading — keep product flag until photos resolve.
  if (photos == null) {
    return product.needsPhotoReview === true;
  }

  if (product.needsPhotoReview) {
    return true;
  }

  if (photos.length === 0) {
    return false;
  }

  return photos.some(needsAiPhotoApproval);
}

function MobileProductCard({
  dragActive,
  groupLabel,
  isDragSource,
  isPending,
  lastError,
  measureElement,
  onAddToGroup,
  onArchive,
  onDelete,
  onDeletePhotos,
  onDeleteShopifyFile,
  onOpenPhoto,
  onPublish,
  onUnarchive,
  photos,
  row,
  shiftY,
  shopDomain,
  virtualRow,
}: {
  dragActive: boolean;
  groupLabel: string;
  isDragSource: boolean;
  isPending: boolean;
  lastError?: LastError;
  measureElement: (node: Element | null) => void;
  onAddToGroup: (product: Product) => void;
  onArchive: (product: Product) => void;
  onDelete: (product: Product) => void;
  onDeletePhotos: (product: Product) => void;
  onDeleteShopifyFile: (product: Product) => void;
  onOpenPhoto: (product: Product) => void;
  onPublish: (product: Product) => void;
  onUnarchive: (product: Product) => void;
  photos?: ProductPhoto[] | null;
  row: Row<Product>;
  shiftY: number;
  shopDomain?: string | null;
  virtualRow: VirtualItem;
}) {
  const product = row.original;
  const { attributes, listeners, setNodeRef } = useDraggable({ id: row.id });
  const photoCount = photos ? listOriginals(photos).length : undefined;

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
          <ProductThumbnail
            className="h-[52px] w-[52px]"
            onClick={() => onOpenPhoto(product)}
            photoCount={photoCount}
            photos={photos}
            product={product}
          />
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
              lastError={lastError ?? product.lastError}
              needsPhotoReview={productNeedsPhotoReview(product, photos)}
              pendingOperation={product.pendingOperation}
              phase={product.phase}
              saving={isPending}
              shopDomain={shopDomain}
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
                  onArchive={() => onArchive(product)}
                  onDelete={() => onDelete(product)}
                  onDeletePhotos={() => onDeletePhotos(product)}
                  onDeleteShopifyFile={() => onDeleteShopifyFile(product)}
                  onOpenPhoto={() => onOpenPhoto(product)}
                  onPublish={() => onPublish(product)}
                  onUnarchive={() => onUnarchive(product)}
                  photos={photos}
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
function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      values.push(current.trim());
      if (values.some((value) => value.length > 0)) {
        rows.push(values);
      }
      values = [];
      current = "";
    } else if (char === "\r" && nextChar === "\n") {
      current += "\n";
      index += 1;
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  if (values.some((value) => value.length > 0)) {
    rows.push(values);
  }

  return rows;
}

function normalizeCsvHeader(value: string) {
  return value.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

function findCsvColumnIndex(header: string[], names: string[]) {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

const CSV_SKU_HEADERS = ["sku", "variant sku", "product sku"];
const CSV_NAME_HEADERS = ["name", "title", "product name", "product title"];
const CSV_PRICE_HEADERS = ["price", "variant price", "variant price usd"];
const CSV_DESCRIPTION_HEADERS = [
  "description",
  "body",
  "body html",
  "body (html)",
];
const CSV_VENDOR_HEADERS = [
  "vendor",
  "vendor name",
  "supplier",
  "brand",
  "manufacturer",
];
const CSV_TAGS_HEADERS = ["tags", "tag"];

function parseProductCsv(text: string) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));

  if (rows.length === 0) {
    return {
      error: "Choose a CSV file with sku, name, and price columns.",
      products: [] as CsvProduct[],
      skippedRows: 0,
    };
  }

  const header = rows[0].map(normalizeCsvHeader);
  const headerSkuIndex = findCsvColumnIndex(header, CSV_SKU_HEADERS);
  const headerNameIndex = findCsvColumnIndex(header, CSV_NAME_HEADERS);
  const headerPriceIndex = findCsvColumnIndex(header, CSV_PRICE_HEADERS);
  // Treat the first row as headers whenever required columns are labeled,
  // including Shopify-style Title / Variant SKU / Variant Price names.
  const hasHeader =
    headerSkuIndex >= 0 && headerNameIndex >= 0 && headerPriceIndex >= 0;
  const skuIndex = hasHeader ? headerSkuIndex : 0;
  const nameIndex = hasHeader ? headerNameIndex : 1;
  const priceIndex = hasHeader ? headerPriceIndex : 2;
  // Headerless optional columns use fixed positions matching the import help text:
  // sku, name, price, description, vendor, tags.
  const descriptionIndex = hasHeader
    ? findCsvColumnIndex(header, CSV_DESCRIPTION_HEADERS)
    : 3;
  const vendorIndex = hasHeader
    ? findCsvColumnIndex(header, CSV_VENDOR_HEADERS)
    : 4;
  const tagsIndex = hasHeader
    ? findCsvColumnIndex(header, CSV_TAGS_HEADERS)
    : 5;
  const hasDescriptionColumn = descriptionIndex >= 0;
  const hasVendorColumn = vendorIndex >= 0;
  const hasTagsColumn = tagsIndex >= 0;
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

    if (hasVendorColumn) {
      const vendor = row[vendorIndex]?.trim() ?? "";
      if (vendor) {
        product.vendor = vendor;
      }
    }

    if (hasTagsColumn) {
      const tags = normalizeTagString(row[tagsIndex]);
      if (tags) {
        product.tags = tags;
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
    deleteProductPhoto,
    deleteProducts,
    deleteShopifyFile,
    archiveProducts,
    groups,
    isProductPending,
    isLoading,
    products,
    importProducts,
    listingJobs,
    publishProducts,
    reorderProducts,
    session,
    shopifyConnection,
    unarchiveProducts,
    updateProduct,
  } = useAppData();
  const shopDomain = shopifyConnection?.shopDomain ?? null;
  const navigate = useNavigate();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const desktopBodyRef = React.useRef<HTMLTableSectionElement>(null);
  const cardListRef = React.useRef<HTMLDivElement>(null);
  const mobileListRef = React.useRef<HTMLDivElement>(null);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const groupFilter = searchParams.get("group");
  const viewFilter: ProductsView =
    searchParams.get("view") === VIEW_ARCHIVED ? VIEW_ARCHIVED : VIEW_ACTIVE;
  const filteredProducts = React.useMemo(() => {
    const byView = products.filter((product) =>
      viewFilter === VIEW_ARCHIVED
        ? isArchived(product)
        : !isArchived(product),
    );

    if (!groupFilter) {
      return byView;
    }

    if (groupFilter === UNGROUPED_FILTER) {
      return byView.filter((product) => !product.groupId);
    }

    return byView.filter((product) => product.groupId === groupFilter);
  }, [groupFilter, products, viewFilter]);
  const filteredProductIds = React.useMemo(
    () => filteredProducts.map((product) => product._id),
    [filteredProducts],
  );
  const photosByProductIdQuery = useQuery(
    convexApi.productPhotos.listForProducts,
    filteredProductIds.length > 0
      ? {
          productIds: filteredProductIds,
          sessionToken: session.sessionToken,
        }
      : "skip",
  );
  const photosByProductId = React.useMemo(() => {
    const map: Record<string, ProductPhoto[]> = {};

    if (!photosByProductIdQuery) {
      return map;
    }

    for (const [productId, photos] of Object.entries(photosByProductIdQuery)) {
      map[productId] = photos as ProductPhoto[];
    }

    return map;
  }, [photosByProductIdQuery]);
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
  const [addPartDescription, setAddPartDescription] = React.useState("");
  const [addPartVendor, setAddPartVendor] = React.useState("");
  const [addPartTags, setAddPartTags] = React.useState("");
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
  const [isParsingImport, setIsParsingImport] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [selectedGroupId, setSelectedGroupId] = React.useState<Id<"groups"> | "">("");
  const [newGroupName, setNewGroupName] = React.useState("");
  const [isCreatingGroup, setIsCreatingGroup] = React.useState(false);
  const [photoProductId, setPhotoProductId] =
    React.useState<Id<"products"> | null>(null);
  const [activeDescriptionId, setActiveDescriptionId] =
    React.useState<Id<"products"> | null>(null);
  const [pendingCellFocus, setPendingCellFocus] = React.useState<{
    columnId: EditableColumnId;
    productId: Id<"products">;
  } | null>(null);
  const [desktopRowMenu, setDesktopRowMenu] = React.useState<{
    product: Product;
    x: number;
    y: number;
  } | null>(null);
  const [overwritePublish, setOverwritePublish] = React.useState<{
    productIds: Id<"products">[];
    skus: string[];
  } | null>(null);
  const [isOverwritePublishing, setIsOverwritePublishing] = React.useState(false);
  const focusNextCellRef = React.useRef<
    (currentId: Id<"products">, columnId: EditableColumnId) => void
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
  const existingShopifyProductIdByProductId = React.useMemo(() => {
    const map = new Map<string, string>();

    // listingJobs are ordered newest-first; keep the first match per product.
    for (const job of listingJobs) {
      if (job.status !== "failed" || map.has(job.productId)) {
        continue;
      }

      const result = job.result as
        | { existingShopifyProductId?: unknown }
        | null
        | undefined;
      const existingId = result?.existingShopifyProductId;

      if (typeof existingId === "string" && existingId) {
        map.set(job.productId, existingId);
      }
    }

    return map;
  }, [listingJobs]);

  function resolveLastError(product: Product): LastError | undefined {
    const lastError = product.lastError;
    if (!lastError || lastError.code !== "duplicateSku") {
      return lastError;
    }

    if (lastError.existingShopifyProductId) {
      return lastError;
    }

    const fromJob = existingShopifyProductIdByProductId.get(product._id);
    if (!fromJob) {
      return lastError;
    }

    return {
      ...lastError,
      existingShopifyProductId: fromJob,
    };
  }

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
            data-product-cell={`${row.original._id}:sku`}
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
            onKeyDown={(event) =>
              handleEditableInputEnter(event, () =>
                focusNextCellRef.current(row.original._id, "sku"),
              )
            }
          />
        ),
      }),
      columnHelper.accessor("name", {
        header: "Name",
        cell: ({ row }) => {
          const photos = photosByProductId[row.original._id];
          const photoCount = photos ? listOriginals(photos).length : undefined;

          return (
            <div className="flex min-w-0 w-full items-center gap-2.5">
              <ProductThumbnail
                className="h-10 w-10"
                onClick={() => setPhotoProductId(row.original._id)}
                photoCount={photoCount}
                photos={photos}
                product={row.original}
              />
              <Input
                aria-label={`Name for ${row.original.sku}`}
                className={cn(desktopTableInputClass, "min-w-0 flex-1")}
                data-product-cell={`${row.original._id}:name`}
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
                onKeyDown={(event) =>
                  handleEditableInputEnter(event, () =>
                    focusNextCellRef.current(row.original._id, "name"),
                  )
                }
              />
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "description",
        header: "Description",
        cell: ({ row }) => (
          <DescriptionField
            aria-label={`Description for ${row.original.sku}`}
            className="w-full"
            onNavigateNext={() =>
              focusNextCellRef.current(row.original._id, "description")
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
            data-product-cell={`${row.original._id}:price`}
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
            onKeyDown={(event) =>
              handleEditableInputEnter(event, () =>
                focusNextCellRef.current(row.original._id, "price"),
              )
            }
          />
        ),
      }),
      columnHelper.display({
        id: "vendor",
        header: "Vendor",
        cell: ({ row }) => (
          <Input
            aria-label={`Vendor for ${row.original.sku}`}
            className={desktopTableInputClass}
            data-product-cell={`${row.original._id}:vendor`}
            // Remount when CSV import / remote updates change vendor so the
            // uncontrolled input does not keep a stale empty defaultValue.
            key={`${row.original._id}:vendor:${row.original.vendor ?? ""}`}
            defaultValue={row.original.vendor ?? ""}
            title={row.original.vendor ?? ""}
            variant="ghost"
            onBlur={(event) => {
              const vendor = event.currentTarget.value.trim();
              const current = row.original.vendor ?? "";

              if (vendor !== current) {
                void updateProduct({
                  id: row.original._id,
                  vendor,
                }).catch(() => undefined);
              }
            }}
            onKeyDown={(event) =>
              handleEditableInputEnter(event, () =>
                focusNextCellRef.current(row.original._id, "vendor"),
              )
            }
          />
        ),
      }),
      columnHelper.display({
        id: "tags",
        header: "Tags",
        cell: ({ row }) => (
          <Input
            aria-label={`Tags for ${row.original.sku}`}
            className={desktopTableInputClass}
            data-product-cell={`${row.original._id}:tags`}
            key={`${row.original._id}:tags:${row.original.tags ?? ""}`}
            defaultValue={row.original.tags ?? ""}
            placeholder="tag-one, tag-two"
            title={row.original.tags ?? ""}
            variant="ghost"
            onBlur={(event) => {
              const tags = normalizeTagString(event.currentTarget.value) ?? "";
              const current = row.original.tags ?? "";

              if (tags !== current) {
                void updateProduct({
                  id: row.original._id,
                  tags,
                }).catch(() => undefined);
              }
            }}
            onKeyDown={(event) =>
              handleEditableInputEnter(event, () =>
                focusNextCellRef.current(row.original._id, "tags"),
              )
            }
          />
        ),
      }),
      columnHelper.accessor("phase", {
        header: "Status",
        cell: ({ row }) => (
          <ProductStatusIcons
            lastError={resolveLastError(row.original)}
            needsPhotoReview={productNeedsPhotoReview(
              row.original,
              photosByProductId[row.original._id],
            )}
            pendingOperation={row.original.pendingOperation}
            phase={row.original.phase}
            saving={isProductPending(row.original._id)}
            shopDomain={shopDomain}
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
    [
      activeDescriptionId,
      existingShopifyProductIdByProductId,
      groupById,
      isProductPending,
      photosByProductId,
      shopDomain,
      updateProduct,
    ],
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
    focusNextCellRef.current = (currentId, columnId) => {
      const index = rows.findIndex((row) => row.original._id === currentId);

      if (index === -1 || index >= rows.length - 1) {
        if (columnId === "description") {
          setActiveDescriptionId(null);
        }
        setPendingCellFocus(null);
        return;
      }

      const nextIndex = index + 1;
      const nextProductId = rows[nextIndex].original._id;
      rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
      window.requestAnimationFrame(() => {
        if (columnId === "description") {
          setActiveDescriptionId(nextProductId);
          setPendingCellFocus(null);
          return;
        }

        setPendingCellFocus({
          columnId,
          productId: nextProductId,
        });
      });
    };
  }, [rows, rowVirtualizer]);

  React.useEffect(() => {
    if (!pendingCellFocus) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    function tryFocus() {
      if (cancelled || !pendingCellFocus) {
        return;
      }

      const element = document.querySelector<HTMLInputElement>(
        productCellSelector(
          pendingCellFocus.productId,
          pendingCellFocus.columnId,
        ),
      );

      if (element) {
        element.focus();
        element.select();
        setPendingCellFocus(null);
        return;
      }

      attempts += 1;
      if (attempts < 30) {
        window.requestAnimationFrame(tryFocus);
        return;
      }

      setPendingCellFocus(null);
    }

    tryFocus();

    return () => {
      cancelled = true;
    };
  }, [pendingCellFocus]);
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
  const viewFilterLabel =
    viewFilter === VIEW_ARCHIVED ? "Archived" : "Active";
  const selectedCanArchive = selectedRows.some((row) =>
    canArchive(row.original),
  );
  const selectedAreArchived = selectedRows.some((row) =>
    isArchived(row.original),
  );
  const photosBatchLoading =
    filteredProductIds.length > 0 && photosByProductIdQuery === undefined;
  const selectedCanPublish =
    !photosBatchLoading &&
    hasSelection &&
    viewFilter !== VIEW_ARCHIVED &&
    selectedRows.every((row) =>
      canPublishProduct(
        {
          aiImageStatus: row.original.aiImageStatus,
          aiShopifyFileId: row.original.aiShopifyFileId ?? undefined,
          needsPhotoReview: row.original.needsPhotoReview,
          pendingOperation: row.original.pendingOperation ?? undefined,
          phase: row.original.phase,
          shopifyFileId: row.original.shopifyFileId ?? undefined,
        },
        photosByProductId[row.original._id],
      ),
    );
  const selectedNeedOverwrite = selectedRows.some((row) =>
    isDuplicateSkuError(row.original),
  );
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

  function handleDeleteProducts(ids: Id<"products">[]) {
    if (ids.length === 0) {
      return Promise.resolve();
    }

    const idSet = new Set(ids);

    setRowSelection((current) => {
      const next = { ...current };
      let changed = false;

      for (const id of ids) {
        if (next[id]) {
          delete next[id];
          changed = true;
        }
      }

      return changed ? next : current;
    });
    setPhotoProductId((current) =>
      current && idSet.has(current) ? null : current,
    );
    setActiveDragProductId((current) => {
      if (current && idSet.has(current)) {
        setProjectedIndex(null);
        return null;
      }

      return current;
    });

    return deleteProducts(ids);
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

  function setViewFilter(value: ProductsView) {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);

        if (value === VIEW_ARCHIVED) {
          next.set("view", VIEW_ARCHIVED);
        } else {
          next.delete("view");
        }

        return next;
      },
      { replace: true },
    );
    clearSelection();
  }

  function handleArchiveProducts(ids: Id<"products">[]) {
    if (ids.length === 0) {
      return Promise.resolve();
    }

    return archiveProducts(ids).then(() => {
      clearSelection();
    });
  }

  function handleUnarchiveProducts(ids: Id<"products">[]) {
    if (ids.length === 0) {
      return Promise.resolve();
    }

    return unarchiveProducts(ids).then(() => {
      clearSelection();
    });
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

    await handleDeleteProducts(selectedProductIds).catch(() => undefined);
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

    const targets = selectedRows.map((row) => row.original);
    const needsOverwrite = targets.some(isDuplicateSkuError);

    await requestPublishProducts(targets);

    // Keep selection while the overwrite confirmation dialog is open.
    if (!needsOverwrite) {
      clearSelection();
    }
  }

  async function requestPublishProducts(targets: Product[]) {
    if (targets.length === 0) {
      return;
    }

    const productIds = targets.map((product) => product._id);
    const overwriteTargets = targets.filter(isDuplicateSkuError);

    if (overwriteTargets.length > 0) {
      setOverwritePublish({
        productIds,
        skus: overwriteTargets.map((product) => product.sku),
      });
      return;
    }

    await publishProducts(productIds);
  }

  async function confirmOverwritePublish() {
    if (!overwritePublish) {
      return;
    }

    setIsOverwritePublishing(true);
    try {
      await publishProducts(overwritePublish.productIds, {
        forceOverwrite: true,
      });
      setOverwritePublish(null);
      clearSelection();
    } catch {
      // The shared data provider reports the error and reverts optimistic state.
    } finally {
      setIsOverwritePublishing(false);
    }
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

  function handleDeletePhotosForProduct(product: Product) {
    const photos = photosByProductId[product._id] ?? [];
    const originals = listOriginals(photos);

    if (originals.length === 0) {
      setPhotoProductId(product._id);
      return;
    }

    if (originals.length > 1) {
      // Multi-photo: open the dialog so the user can pick which pair to remove.
      setPhotoProductId(product._id);
      return;
    }

    const original = originals[0];
    const confirmed =
      product.shopifyStatus === "published"
        ? window.confirm(
            "This product is published. Delete its photo anyway?",
          )
        : window.confirm("Delete this product photo?");

    if (!confirmed) {
      return;
    }

    void deleteProductPhoto(original._id as Id<"productPhotos">, {
      confirmPublishedDelete: product.shopifyStatus === "published",
    }).catch(() => undefined);
  }

  function resetImportDialog() {
    setImportMode("ignore");
    setImportSkuPrefix("");
    setImportFileName("");
    setImportRows([]);
    setImportSkippedRows(0);
    setImportError(null);
    setImportResult(null);
    setIsParsingImport(false);
    setIsImporting(false);
  }

  function resetAddPartDialog() {
    setAddPartSku("");
    setAddPartName("");
    setAddPartPrice("");
    setAddPartDescription("");
    setAddPartVendor("");
    setAddPartTags("");
    setAddPartError(null);
    setIsAddingPart(false);
  }

  async function handleAddPart() {
    const sku = addPartSku.trim();
    const name = addPartName.trim();
    const price = Number.parseFloat(addPartPrice);
    const description = addPartDescription.trim() || undefined;
    const vendor = addPartVendor.trim() || undefined;
    const tags = normalizeTagString(addPartTags);

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
      await createProduct({
        description,
        name,
        price,
        sku,
        tags,
        vendor,
      });
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
      setIsParsingImport(false);
      return;
    }

    setIsParsingImport(true);
    setImportFileName(file.name);
    setImportRows([]);
    setImportSkippedRows(0);
    setImportError(null);

    // Yield so React can paint the spinner before synchronous CSV parsing.
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    try {
      const text = await file.text();
      const parsed = parseProductCsv(text);

      setImportRows(parsed.products);
      setImportSkippedRows(parsed.skippedRows);
      setImportError(parsed.error);
    } catch {
      setImportRows([]);
      setImportSkippedRows(0);
      setImportError("The CSV file could not be read.");
    } finally {
      setIsParsingImport(false);
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
      await importProducts({
        existingEntryBehavior: importMode,
        products: importRows.map((product) => ({
          ...product,
          sku: skuPrefix ? `${skuPrefix}-${product.sku}` : product.sku,
        })),
      });

      setImportOpen(false);
      resetImportDialog();
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Products could not be imported.",
      );
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
              {groups
                .filter((group) => !isGroupArchived(group))
                .map((group) => (
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="max-w-40 px-3 text-slate-950 md:px-4"
                variant="outline"
              >
                <Archive className="h-4 w-4" />
                <span className="truncate">{viewFilterLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setViewFilter(VIEW_ACTIVE)}>
                <span className="flex-1">Active</span>
                {viewFilter === VIEW_ACTIVE ? <Check /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setViewFilter(VIEW_ARCHIVED)}>
                <span className="flex-1">Archived</span>
                {viewFilter === VIEW_ARCHIVED ? <Check /> : null}
              </DropdownMenuItem>
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
              disabled={!selectedCanPublish}
              onSelect={() =>
                void handlePublishSelected().catch(() => undefined)
              }
            >
              <Send />
              {selectedNeedOverwrite ? "Publish & overwrite" : "Publish"}
            </DropdownMenuItem>
            {viewFilter === VIEW_ARCHIVED ? (
              <DropdownMenuItem
                disabled={!hasSelection || !selectedAreArchived}
                onSelect={() =>
                  void handleUnarchiveProducts(selectedProductIds).catch(
                    () => undefined,
                  )
                }
              >
                <ArchiveRestore />
                Unarchive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={!hasSelection || !selectedCanArchive}
                onSelect={() =>
                  void handleArchiveProducts(selectedProductIds).catch(
                    () => undefined,
                  )
                }
              >
                <Archive />
                Archive
              </DropdownMenuItem>
            )}
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
              Upload a CSV with sku, name, and price columns. Description, vendor,
              and tags are optional when those columns are present. Existing SKUs
              can be overwritten or ignored.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="product-csv">
                CSV file
              </label>
              <Input
                accept=".csv,text/csv"
                disabled={isParsingImport || isImporting}
                id="product-csv"
                onChange={(event) =>
                  void handleImportFileChange(event).catch(() => undefined)
                }
                type="file"
              />
              <p className="text-xs text-slate-500">
                Header row is optional when columns are ordered as SKU, name,
                price, description, vendor, tags. Header names like Title,
                Variant SKU, Variant Price, and Vendor are also recognized.
                Tags should be comma-separated.
              </p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="sku-prefix">
                Prefix
              </label>
              <Input
                disabled={isParsingImport || isImporting}
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
                disabled={isParsingImport || isImporting}
                id="overwrite-existing"
                onCheckedChange={(checked) =>
                  setImportMode(checked ? "overwrite" : "ignore")
                }
              />
            </div>

            {isParsingImport ? (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <div>
                  <p className="font-medium text-slate-950">{importFileName}</p>
                  <p className="mt-1">Parsing CSV…</p>
                </div>
              </div>
            ) : importFileName ? (
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
            <Button
              disabled={isParsingImport || isImporting}
              onClick={() => setImportOpen(false)}
              variant="outline"
            >
              Close
            </Button>
            <Button
              disabled={
                importRows.length === 0 || isParsingImport || isImporting
              }
              onClick={() => void handleImportProducts().catch(() => undefined)}
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import products"
              )}
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
              Enter the SKU, name, and price for a new product. Description,
              vendor, and tags are optional.
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
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="add-part-description"
              >
                Description
              </label>
              <textarea
                className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-offset-white placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
                id="add-part-description"
                onChange={(event) => {
                  setAddPartDescription(event.currentTarget.value);
                  setAddPartError(null);
                }}
                placeholder="Optional product description"
                value={addPartDescription}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="add-part-vendor">
                Vendor
              </label>
              <Input
                id="add-part-vendor"
                onChange={(event) => {
                  setAddPartVendor(event.currentTarget.value);
                  setAddPartError(null);
                }}
                placeholder="Optional vendor"
                value={addPartVendor}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="add-part-tags">
                Tags
              </label>
              <Input
                id="add-part-tags"
                onChange={(event) => {
                  setAddPartTags(event.currentTarget.value);
                  setAddPartError(null);
                }}
                placeholder="tag-one, tag-two"
                value={addPartTags}
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
          {groups.some((group) => !isGroupArchived(group)) ? (
            <div className="grid max-h-56 gap-2 overflow-y-auto">
              {groups
                .filter((group) => !isGroupArchived(group))
                .map((group) => (
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
              {groups.every((group) => isGroupArchived(group))
                ? "Create a group"
                : "Or create a new group"}
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
        onOpenProduct={setPhotoProductId}
        photosByProductId={
          photosByProductIdQuery === undefined ? undefined : photosByProductId
        }
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
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] md:hidden"
          ref={cardListRef}
        >
          {!isLoading && rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              {viewFilter === VIEW_ARCHIVED
                ? "No archived products."
                : groupFilter
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
              if (!row) {
                return null;
              }

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
                  lastError={resolveLastError(product)}
                  measureElement={cardVirtualizer.measureElement}
                  onAddToGroup={(target) => {
                    setRowSelection({ [target._id]: true });
                    setAddToGroupOpen(true);
                  }}
                  onArchive={(target) =>
                    void handleArchiveProducts([target._id]).catch(
                      () => undefined,
                    )
                  }
                  onDelete={(target) =>
                    void handleDeleteProducts([target._id]).catch(() => undefined)
                  }
                  onDeletePhotos={handleDeletePhotosForProduct}
                  onDeleteShopifyFile={handleDeleteShopifyFileForProduct}
                  onOpenPhoto={(target) => setPhotoProductId(target._id)}
                  onPublish={(target) =>
                    void requestPublishProducts([target]).catch(() => undefined)
                  }
                  onUnarchive={(target) =>
                    void handleUnarchiveProducts([target._id]).catch(
                      () => undefined,
                    )
                  }
                  photos={photosByProductId[product._id]}
                  row={row}
                  shiftY={getDropShift({
                    activeIndex: activeDragIndex,
                    activeSize: activeCardSizeRef.current,
                    index: virtualRow.index,
                    projectedIndex,
                  })}
                  shopDomain={shopDomain}
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
                <ProductThumbnail
                  className="h-[52px] w-[52px]"
                  photoCount={
                    photosByProductId[activeDragProduct._id]
                      ? listOriginals(photosByProductId[activeDragProduct._id])
                          .length
                      : undefined
                  }
                  photos={photosByProductId[activeDragProduct._id]}
                  product={activeDragProduct}
                />
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
                    lastError={resolveLastError(activeDragProduct)}
                    needsPhotoReview={productNeedsPhotoReview(
                      activeDragProduct,
                      photosByProductId[activeDragProduct._id],
                    )}
                    pendingOperation={activeDragProduct.pendingOperation}
                    phase={activeDragProduct.phase}
                    saving={isProductPending(activeDragProduct._id)}
                    shopDomain={shopDomain}
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
                className="min-h-0 flex-1 basis-0 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm [scrollbar-gutter:stable]"
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
                              header.column.id === "price" ||
                              header.column.id === "vendor" ||
                              header.column.id === "tags"
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
                if (!row) {
                  return null;
                }

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
              {viewFilter === VIEW_ARCHIVED
                ? "No archived products."
                : groupFilter
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
                        cell.column.id === "price" ||
                        cell.column.id === "vendor" ||
                        cell.column.id === "tags"
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
              onArchive={() =>
                void handleArchiveProducts([desktopRowMenu.product._id]).catch(
                  () => undefined,
                )
              }
              onDelete={() =>
                void handleDeleteProducts([desktopRowMenu.product._id]).catch(
                  () => undefined,
                )
              }
              onDeletePhotos={() =>
                handleDeletePhotosForProduct(desktopRowMenu.product)
              }
              onDeleteShopifyFile={() =>
                handleDeleteShopifyFileForProduct(desktopRowMenu.product)
              }
              onOpenPhoto={() => setPhotoProductId(desktopRowMenu.product._id)}
              onPublish={() =>
                void requestPublishProducts([desktopRowMenu.product]).catch(
                  () => undefined,
                )
              }
              onUnarchive={() =>
                void handleUnarchiveProducts([
                  desktopRowMenu.product._id,
                ]).catch(() => undefined)
              }
              photos={photosByProductId[desktopRowMenu.product._id]}
              product={desktopRowMenu.product}
            />
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isOverwritePublishing) {
            setOverwritePublish(null);
          }
        }}
        open={overwritePublish !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overwrite existing Shopify product?</DialogTitle>
            <DialogDescription>
              {overwritePublish && overwritePublish.skus.length === 1
                ? `A Shopify product with SKU ${overwritePublish.skus[0]} already exists. Publishing will update that product instead of creating a new one.`
                : overwritePublish
                  ? `${overwritePublish.skus.length.toLocaleString()} selected products already exist on Shopify with matching SKUs. Publishing will update those products instead of creating new ones.`
                  : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isOverwritePublishing}
              onClick={() => setOverwritePublish(null)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={isOverwritePublishing}
              onClick={() =>
                void confirmOverwritePublish().catch(() => undefined)
              }
              type="button"
            >
              {isOverwritePublishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Publishing…
                </>
              ) : (
                "Publish & overwrite"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
