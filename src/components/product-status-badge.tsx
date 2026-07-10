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
} from "lucide-react";
import { Badge } from "./ui/badge";
import {
  phaseLabels,
  pendingOperationLabels,
  type LastError,
  type PendingOperation,
  type ProductPhase,
} from "../lib/product-state";
import { cn } from "../lib/utils";

const phaseIconClass: Record<ProductPhase, string> = {
  imported: "bg-blue-100 text-blue-600",
  captured: "bg-sky-100 text-sky-700",
  published: "bg-green-100 text-green-600",
};

function StatusIcon({
  className,
  icon,
  label,
  reason,
  toneClass,
}: {
  className?: string;
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
  const interactive = Boolean(reason);
  const tooltipText = reason ? `${label} — ${reason}` : label;

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
    if (!open || !reason) {
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
  }, [open, reason, updatePosition, tooltipText]);

  React.useEffect(() => {
    if (!open || hoverCapable) {
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
  }, [hoverCapable, open]);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => hoverCapable && setOpen(true)}
      onMouseLeave={() => hoverCapable && setOpen(false)}
      ref={containerRef}
    >
      <span
        aria-label={tooltipText}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          toneClass,
          interactive && "cursor-default",
        )}
        onClick={() => {
          if (interactive && !hoverCapable) {
            setOpen((value) => !value);
          }
        }}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        title={interactive ? undefined : label}
        onKeyDown={
          interactive
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
      {open && reason
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
  saving,
  className,
}: {
  phase: ProductPhase;
  pendingOperation?: PendingOperation;
  lastError?: LastError;
  needsPhotoReview?: boolean;
  saving?: boolean;
  className?: string;
}) {
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
      {lastError ? (
        <StatusIcon
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          label="Couldn't complete last action"
          reason={lastError.message}
          toneClass="bg-red-100 text-red-600"
        />
      ) : null}
      {saving ? (
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-800"
          title="Saving changes"
        >
          <Cloud className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </div>
  );
}

export function ProductStatusBadge({
  phase,
  pendingOperation,
  lastError,
  needsPhotoReview,
  className,
}: {
  phase: ProductPhase;
  pendingOperation?: PendingOperation;
  lastError?: LastError;
  needsPhotoReview?: boolean;
  className?: string;
}) {
  const modifiers = [
    pendingOperation ? pendingOperationLabels[pendingOperation] : null,
    needsPhotoReview ? "Review photo" : null,
    lastError ? lastError.message : null,
  ].filter(Boolean);

  return (
    <Badge className={className} variant="outline">
      {phaseLabels[phase]}
      {modifiers.length > 0 ? ` — ${modifiers.join(" · ")}` : ""}
    </Badge>
  );
}
