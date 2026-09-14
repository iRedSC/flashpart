import * as React from "react";
import { useAction } from "convex/react";
import { useAppData } from "../data/app-data-provider";
import { convexApi } from "../lib/convex-api";
import { Input } from "./ui/input";

export function ShopifyProductTypeSelect({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ShopifyCatalogValueSelect
      kind="product type"
      onChange={onChange}
      value={value}
    />
  );
}

export function ShopifyVendorSelect({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ShopifyCatalogValueSelect
      kind="vendor"
      onChange={onChange}
      value={value}
    />
  );
}

function ShopifyCatalogValueSelect({
  kind,
  onChange,
  value,
}: {
  kind: "product type" | "vendor";
  value: string;
  onChange: (value: string) => void;
}) {
  const { session, shopifyConnection } = useAppData();
  const loadProductTypes = useAction(convexApi.shopify.productTypes);
  const loadProductVendors = useAction(convexApi.shopify.productVendors);
  const load = kind === "vendor" ? loadProductVendors : loadProductTypes;
  const pluralLabel = kind === "vendor" ? "vendors" : "product types";
  const [values, setValues] = React.useState<string[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const id = React.useId();

  React.useEffect(() => { setSearch(value); }, [value]);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void load({ sessionToken: session.sessionToken })
      .then(values => { if (!cancelled) setValues(values); })
      .catch(error => {
        if (!cancelled) {
          setError(
            error instanceof Error
              ? error.message
              : `Could not load ${pluralLabel}.`,
          );
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load, session.sessionToken, shopifyConnection?.shopDomain, shopifyConnection?.updatedAt]);

  const options = values.filter(option => option.toLowerCase().includes(search.toLowerCase()));

  function choose(option: string) {
    onChange(option);
    setSearch(option);
    setOpen(false);
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setSearch(value);
        }
      }}
    >
      <Input
        aria-label={kind === "vendor" ? "Vendor" : "Product type"}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
        value={search}
        placeholder={
          loading
            ? `Loading ${pluralLabel}…`
            : `Search Shopify ${pluralLabel}`
        }
        onFocus={() => { setOpen(true); setSearch(""); setActive(0); }}
        onChange={(event) => { setSearch(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(index => Math.min(index + 1, options.length - 1));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(index => Math.max(0, index - 1));
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            if (options[active]) choose(options[active]);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setSearch(value);
          }
        }}
      />
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={kind === "vendor" ? "Vendors" : "Product types"}
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-white p-1 shadow-lg"
        >
          {options.map((option, index) => (
            <button
              key={option}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              type="button"
              className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 ${index === active ? "bg-slate-100" : ""}`}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
          {!options.length && (
            <p className="p-3 text-sm text-slate-500">
              {loading ? "Loading…" : error || `No matching ${pluralLabel}`}
            </p>
          )}
        </div>
      )}
      {error && !open && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
