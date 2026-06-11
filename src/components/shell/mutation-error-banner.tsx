import { AlertTriangle, X } from "lucide-react";
import { Button } from "../ui/button";
import { useAppData } from "../../data/app-data-provider";

export function MutationErrorBanner() {
  const { clearMutationError, lastMutationError } = useAppData();

  if (!lastMutationError) {
    return null;
  }

  return (
    <div className="border-b border-red-200 bg-red-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 text-sm text-red-900 md:px-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {lastMutationError.label} failed. The UI was reverted.{" "}
            {lastMutationError.message}
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
