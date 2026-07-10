import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Camera,
  CircleCheck,
  Cloud,
  Download,
  Eye,
  Loader2,
  Pencil,
} from "lucide-react";
import { Badge } from "./ui/badge";
import {
  phaseLabels,
  pendingOperationLabels,
  type LastError,
  type PendingOperation,
  type ProductPhase,
} from "../lib/product-state";
import { shopifyAdminProductUrl } from "../lib/shopify-admin";
import { cn } from "../lib/utils";

const phaseIconClass: Record<ProductPhase, string> = {
  imported: "bg-blue-100 text-blue-600",
  captured: "bg-sky-100 text-sky-700",
  published: "bg-green-100 text-green-600",
};

export function StatusIcon({
  className,
  href,
  icon,
  label,
  reason,
  toneClass,
}: {
  className?: string;
  href?: string | null;
  icon: React.ReactNode;
  label: string;
  reason?: string;
  toneClass: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{
    left: number;
    top: number;
  } | null>(null);
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const tooltipRef = React.useRef<HTMLSpanElement>(null);
  const hoverCapable = React.useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover)").matches,
    [],
  );
  // Touch devices need a tap target; keyboard focus is only useful there.
  // Hover-capable pointers use mouse enter/leave and should not add tab stops.
  // Links are always focusable for keyboard access to the admin URL.
  const tapToggle = !hoverCapable && !href;
  const tooltipText = href
    ? reason
      ? `${label} — ${reason} Open in Shopify admin.`
      : `${label} — Open in Shopify admin`
    : reason
      ? `${label} — ${reason}`
      : label;

  const updatePosition = React.useCallback(() => {
    const trigger = containerRef.current?.getBoundingClientRect();
    if (!trigger) {
      return;
    }

    const tooltip = tooltipRef.current?.getBoundingClientRect();
    const tooltipWidth = tooltip?.width ?? 240;
    const tooltipHeight = tooltip?.height ?? 40;
    const gap = 6;
    const padding = 8;

    let left = trigger.left + trigger.width / 2 - tooltipWidth / 2;
    left = Math.max(
      padding,
      Math.min(left, window.innerWidth - tooltipWidth - padding),
    );

    const spaceAbove = trigger.top - padding;
    const placeBelow =
      spaceAbove < tooltipHeight + gap &&
      window.innerHeight - trigger.bottom > spaceAbove;
    const top = placeBelow
      ? trigger.bottom + gap
      : trigger.top - tooltipHeight - gap;

    setPosition({ left, top });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    // Re-measure after the tooltip has its real size.
    const frame = window.requestAnimationFrame(() => updatePosition());

    function handleScrollOrResize() {
      updatePosition();
    }

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition, tooltipText]);

  React.useEffect(() => {
    if (!open || !tapToggle) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, tapToggle]);

  const iconClassName = cn(
    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
    toneClass,
    href ? "cursor-pointer" : tapToggle && "cursor-default",
  );

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => hoverCapable && setOpen(true)}
      onMouseLeave={() => hoverCapable && setOpen(false)}
      ref={containerRef}
    >
      {href ? (
        <a
          aria-label={tooltipText}
          className={iconClassName}
          href={href}
          onClick={(event) => {
            // Keep row/card click handlers from treating this as a selection.
            event.stopPropagation();
          }}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
          title={tooltipText}
        >
          {icon}
        </a>
      ) : (
        <span
          aria-label={tooltipText}
          className={iconClassName}
          onBlur={() => {
            if (tapToggle) {
              setOpen(false);
            }
          }}
          onClick={() => {
            if (tapToggle) {
              setOpen((value) => !value);
            }
          }}
          role={tapToggle ? "button" : undefined}
          tabIndex={tapToggle ? 0 : undefined}
          title={tooltipText}
          onKeyDown={
            tapToggle
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpen((value) => !value);
                  }
                }
              : undefined
          }
        >
          {icon}
        </span>
      )}
      {open
        ? createPortal(
            <span
              className={cn(
                "pointer-events-none fixed z-50 max-w-[240px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-normal text-slate-950 shadow-md",
                !position && "invisible",
              )}
              ref={tooltipRef}
              role="tooltip"
              style={
                position
                  ? { left: position.left, top: position.top }
                  : { left: 0, top: 0 }
              }
            >
              {tooltipText}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function PhaseIcon({ phase }: { phase: ProductPhase }) {
  const icons: Record<ProductPhase, React.ReactNode> = {
    imported: <Download className="h-3.5 w-3.5" />,
    captured: <Camera className="h-3.5 w-3.5" />,
    published: <CircleCheck className="h-3.5 w-3.5" />,
  };

  return (
    <StatusIcon
      icon={icons[phase]}
      label={phaseLabels[phase]}
      toneClass={phaseIconClass[phase]}
    />
  );
}

export function ProductStatusIcons({
  phase,
  pendingOperation,
  lastError,
  needsPhotoReview,
  needsRepublish,
  saving,
  shopDomain,
  className,
}: {
  phase: ProductPhase;
  pendingOperation?: PendingOperation;
  lastError?: LastError;
  needsPhotoReview?: boolean;
  needsRepublish?: boolean;
  saving?: boolean;
  shopDomain?: string | null;
  className?: string;
}) {
  const duplicateSkuAdminUrl =
    lastError?.code === "duplicateSku"
      ? shopifyAdminProductUrl(
          shopDomain,
          lastError.existingShopifyProductId,
        )
      : null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <PhaseIcon phase={phase} />
      {pendingOperation ? (
        <StatusIcon
          icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
          label={pendingOperationLabels[pendingOperation]}
          toneClass="bg-amber-50 text-amber-800"
        />
      ) : null}
      {needsPhotoReview ? (
        <StatusIcon
          icon={<Eye className="h-3.5 w-3.5" />}
          label="Review photo"
          toneClass="bg-amber-50 text-amber-800"
        />
      ) : null}
      {needsRepublish && phase === "published" ? (
        <StatusIcon
          icon={<Pencil className="h-3.5 w-3.5" />}
          label="Edited"
          reason="Local changes are not on Shopify yet. Republish when ready."
          toneClass="bg-orange-50 text-orange-700"
        />
      ) : null}
      {lastError ? (
        <StatusIcon
          href={duplicateSkuAdminUrl}
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          label="Couldn't complete last action"
          reason={lastError.message}
          toneClass="bg-red-100 text-red-600"
        />
      ) : null}
      {saving ? (
        <StatusIcon
          icon={<Cloud className="h-3.5 w-3.5" />}
          label="Saving changes"
          toneClass="bg-amber-50 text-amber-800"
        />
      ) : null}
    </div>
  );
}

export function ProductStatusBadge({
  phase,
  pendingOperation,
  lastError,
  needsPhotoReview,
  needsRepublish,
  className,
}: {
  phase: ProductPhase;
  pendingOperation?: PendingOperation;
  lastError?: LastError;
  needsPhotoReview?: boolean;
  needsRepublish?: boolean;
  className?: string;
}) {
  const modifiers = [
    pendingOperation ? pendingOperationLabels[pendingOperation] : null,
    needsPhotoReview ? "Review photo" : null,
    needsRepublish && phase === "published" ? "Edited" : null,
    lastError ? lastError.message : null,
  ].filter(Boolean);

  return (
    <Badge className={className} variant="outline">
      {phaseLabels[phase]}
      {modifiers.length > 0 ? ` — ${modifiers.join(" · ")}` : ""}
    </Badge>
  );
}
