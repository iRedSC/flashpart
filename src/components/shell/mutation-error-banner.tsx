import * as React from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "../ui/button";
import { useAppData } from "../../data/app-data-provider";

export function MutationErrorBanner() {
  const { clearMutationError, lastMutationError } = useAppData();

  React.useEffect(() => {
    if (!lastMutationError) {
      return;
    }

    const timeoutId = window.setTimeout(clearMutationError, 8000);

    return () => window.clearTimeout(timeoutId);
  }, [clearMutationError, lastMutationError]);

  if (!lastMutationError) {
    return null;
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 shadow-lg md:inset-x-auto md:right-6">
      <div className="flex items-start justify-between gap-4 px-4 py-3 text-sm text-red-900">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {lastMutationError.label} failed. {lastMutationError.message}
          </span>
        </div>
        <Button
          aria-label="Dismiss mutation error"
          onClick={clearMutationError}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
