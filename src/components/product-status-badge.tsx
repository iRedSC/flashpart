import * as React from "react";
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
