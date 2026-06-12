import * as React from "react";
import {
  AlertCircle,
  Ban,
  Camera,
  CircleCheck,
  Cloud,
  Download,
  Eye,
  FilePenLine,
  Folder,
  Loader2,
} from "lucide-react";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

type ProductStatus =
  | "imported"
  | "grouped"
  | "captured"
  | "processing"
  | "draftCreated"
  | "published"
  | "failed"
  | "blockedExistingSku"
  | "needsReview";

type ListingJob = {
  status: string;
  error?: string;
};

const statusTone: Record<
  ProductStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  imported: "secondary",
  grouped: "default",
  captured: "outline",
  processing: "outline",
  draftCreated: "default",
  published: "default",
  failed: "destructive",
  blockedExistingSku: "destructive",
  needsReview: "outline",
};

const statusIconClass: Record<ProductStatus, string> = {
  imported: "bg-slate-100 text-slate-500",
  grouped: "bg-blue-100 text-blue-600",
  captured: "bg-slate-100 text-slate-500",
  processing: "bg-amber-50 text-amber-800",
  draftCreated: "bg-blue-100 text-blue-600",
  published: "bg-green-100 text-green-600",
  failed: "bg-red-100 text-red-600",
  blockedExistingSku: "bg-red-100 text-red-600",
  needsReview: "bg-amber-50 text-amber-800",
};

const statusLabels: Record<ProductStatus, string> = {
  imported: "imported",
  grouped: "grouped",
  captured: "captured",
  processing: "processing",
  draftCreated: "draftCreated",
  published: "published",
  failed: "failed",
  blockedExistingSku: "blockedExistingSku",
  needsReview: "needsReview",
};

function getFailureReason(
  status: ProductStatus,
  error: string | undefined,
  latestJob: ListingJob | undefined,
) {
  if (status === "blockedExistingSku" && !error) {
    return "blockedExistingSku";
  }

  return error ?? latestJob?.error;
}

function getDisplayStatus(
  status: ProductStatus,
  hasCapture: boolean,
): ProductStatus {
  if (
    hasCapture &&
    (status === "failed" || status === "blockedExistingSku")
  ) {
    return "captured";
  }

  return status;
}

function StatusIcon({
  className,
  label,
  reason,
  status,
}: {
  className?: string;
  label: string;
  reason?: string;
  status: ProductStatus;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const hoverCapable = React.useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover)").matches,
    [],
  );
  const icons: Record<ProductStatus, React.ReactNode> = {
    imported: <Download className="h-3.5 w-3.5" />,
    grouped: <Folder className="h-3.5 w-3.5" />,
    captured: <Camera className="h-3.5 w-3.5" />,
    processing: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    draftCreated: <FilePenLine className="h-3.5 w-3.5" />,
    published: <CircleCheck className="h-3.5 w-3.5" />,
    failed: <AlertCircle className="h-3.5 w-3.5" />,
    blockedExistingSku: <Ban className="h-3.5 w-3.5" />,
    needsReview: <Eye className="h-3.5 w-3.5" />,
  };
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
          statusIconClass[status],
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
        {icons[status]}
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

function FailedStatusBadge({
  reason,
  className,
}: {
  reason: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const hoverCapable = React.useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover)").matches,
    [],
  );

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
      <Badge
        aria-expanded={open}
        aria-label={`Failed: ${reason}`}
        className="cursor-default"
        role="button"
        tabIndex={0}
        variant="destructive"
        onClick={() => {
          if (!hoverCapable) {
            setOpen((value) => !value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        failed
      </Badge>
      {open ? (
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

export function ProductStatusIcons({
  status,
  error,
  hasCapture,
  latestJob,
  saving,
  className,
}: {
  status: ProductStatus;
  error?: string;
  hasCapture: boolean;
  latestJob?: ListingJob;
  saving?: boolean;
  className?: string;
}) {
  const displayStatus = getDisplayStatus(status, hasCapture);
  const failureReason = getFailureReason(status, error, latestJob);
  const isHardFailure =
    !hasCapture && (status === "failed" || status === "blockedExistingSku");
  const showFailureIcon = Boolean(failureReason) && !isHardFailure;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {isHardFailure ? (
        <StatusIcon
          label={statusLabels[status]}
          reason={failureReason ?? status}
          status={status}
        />
      ) : (
        <StatusIcon label={statusLabels[displayStatus]} status={displayStatus} />
      )}
      {showFailureIcon && failureReason ? (
        <StatusIcon
          label="failed"
          reason={failureReason}
          status="failed"
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
  status,
  error,
  hasCapture,
  latestJob,
  className,
}: {
  status: ProductStatus;
  error?: string;
  hasCapture: boolean;
  latestJob?: ListingJob;
  className?: string;
}) {
  const displayStatus = getDisplayStatus(status, hasCapture);
  const failureReason = getFailureReason(status, error, latestJob);
  const isHardFailure =
    !hasCapture && (status === "failed" || status === "blockedExistingSku");
  const showFailureBadge = Boolean(failureReason) && !isHardFailure;

  if (isHardFailure) {
    return (
      <FailedStatusBadge
        className={className}
        reason={failureReason ?? status}
      />
    );
  }

  return (
    <>
      <Badge className={className} variant={statusTone[displayStatus]}>
        {displayStatus}
      </Badge>
      {showFailureBadge && failureReason ? (
        <FailedStatusBadge reason={failureReason} />
      ) : null}
    </>
  );
}
