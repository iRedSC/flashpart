import * as React from "react";
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
  imported: "bg-slate-100 text-slate-500",
  captured: "bg-slate-100 text-slate-500",
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
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const hoverCapable = React.useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover)").matches,
    [],
  );
  const interactive = Boolean(reason);

  React.useEffect(() => {
    if (!open || hoverCapable) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
        aria-label={reason ? `${label}: ${reason}` : label}
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
        title={reason ? `${label} — ${reason}` : label}
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
      {open && reason ? (
        <span
          className="absolute bottom-full left-1/2 z-50 mb-1.5 max-w-[240px] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-normal text-slate-950 shadow-md"
          role="tooltip"
        >
          {reason}
        </span>
      ) : null}
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
