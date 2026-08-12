import * as React from "react";
import {
  AlertCircle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PencilLine,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  AI_IMAGE_MODEL_OPTIONS,
  type AiImageModelId,
} from "../lib/ai-image-settings";
import { triggerHaptic } from "../lib/haptics";
import { cn } from "../lib/utils";

export type PhotoReviewView = "original" | "ai";

const REGEN_LONG_PRESS_MS = 500;
const FOOTER_BUTTON_CLASS = "h-9 shrink-0 px-2.5 text-xs sm:px-3 sm:text-sm";

export type PhotoReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  title: string;
  description?: string;

  activeView: PhotoReviewView;
  onActiveViewChange: (view: PhotoReviewView) => void;
  /** When false, hide Original/AI tabs (e.g. no photo yet). Default true. */
  showViewTabs?: boolean;

  photosLoading?: boolean;
  originalUrl?: string | null;
  aiUrl?: string | null;
  aiGenerating?: boolean;
  aiFailed?: boolean;
  aiError?: string | null;
  aiModelLabel?: string | null;
  aiAbsent?: boolean;

  /** Capture preview overlay on the stage (product add/replace). */
  previewUrl?: string | null;
  previewBadge?: string | null;

  pairIndex?: number;
  pairCount?: number;
  onPairIndexChange?: (index: number) => void;
  pairPositionLabel?: string | null;

  error?: string | null;
  stage?: string | null;
  /** Extra note under the stage (e.g. assign-to-group). */
  notice?: string | null;

  busy?: boolean;
  canRegenerate?: boolean;
  showWhiten?: boolean;
  whitening?: boolean;
  regenerating?: boolean;

  promptDialogOpen: boolean;
  onPromptDialogOpenChange: (open: boolean) => void;
  promptDescription: string;
  draftPrompt: string;
  onDraftPromptChange: (value: string) => void;
  defaultPrompt: string;
  onSavePrompt: () => void;
  onUseDefaultPrompt: () => void;

  onRegenerate: (model?: AiImageModelId) => void;
  onWhiten?: () => void;
  onOpenPrompt: () => void;

  /** Shown after Prompt/Regen/Whiten when activeView is AI and not in custom footer mode. */
  aiFooterExtra?: React.ReactNode;
  /**
   * When set, replaces the default AI tool footer (Prompt/Regen/Whiten).
   * Used for capture save flow and original-view product actions.
   */
  footerOverride?: React.ReactNode;

  /** Empty original stage CTA (product take/add photo). */
  emptyOriginalLabel?: string;
  onEmptyOriginalClick?: () => void;
  emptyOriginalDisabled?: boolean;

  /** Disable AI tab when there is nothing to show yet. */
  aiTabDisabled?: boolean;
};

export function PhotoReviewDialog({
  open,
  onOpenChange,
  title,
  description,
  activeView,
  onActiveViewChange,
  showViewTabs = true,
  photosLoading = false,
  originalUrl = null,
  aiUrl = null,
  aiGenerating = false,
  aiFailed = false,
  aiError = null,
  aiModelLabel = null,
  aiAbsent = false,
  previewUrl = null,
  previewBadge = null,
  pairIndex = 0,
  pairCount = 0,
  onPairIndexChange,
  pairPositionLabel = null,
  error = null,
  stage = null,
  notice = null,
  busy = false,
  canRegenerate = true,
  showWhiten = false,
  whitening = false,
  regenerating = false,
  promptDialogOpen,
  onPromptDialogOpenChange,
  promptDescription,
  draftPrompt,
  onDraftPromptChange,
  defaultPrompt,
  onSavePrompt,
  onUseDefaultPrompt,
  onRegenerate,
  onWhiten,
  onOpenPrompt,
  aiFooterExtra,
  footerOverride,
  emptyOriginalLabel,
  onEmptyOriginalClick,
  emptyOriginalDisabled = false,
  aiTabDisabled = false,
}: PhotoReviewDialogProps) {
  const [regenModelMenu, setRegenModelMenu] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  const regenLongPressTimerRef = React.useRef<number | null>(null);
  const suppressRegenClickRef = React.useRef(false);
  const touchStartXRef = React.useRef<number | null>(null);

  const displayUrl = activeView === "ai" ? aiUrl : originalUrl;
  const canNavigatePairs =
    pairCount > 1 && Boolean(onPairIndexChange) && !previewUrl;

  function clearRegenLongPressTimer() {
    if (regenLongPressTimerRef.current != null) {
      window.clearTimeout(regenLongPressTimerRef.current);
      regenLongPressTimerRef.current = null;
    }
  }

  function openRegenModelMenu(x: number, y: number, fromLongPress = false) {
    clearRegenLongPressTimer();
    if (fromLongPress) {
      suppressRegenClickRef.current = true;
    }
    setRegenModelMenu({ x, y });
  }

  function goToPair(nextIndex: number) {
    if (!onPairIndexChange || pairCount <= 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(nextIndex, pairCount - 1));
    if (clamped !== pairIndex) {
      onPairIndexChange(clamped);
      triggerHaptic();
    }
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const startX = touchStartXRef.current;
    touchStartXRef.current = null;
    if (startX == null || previewUrl || pairCount <= 1) {
      return;
    }
    const endX = event.changedTouches[0]?.clientX ?? startX;
    const deltaX = endX - startX;
    if (Math.abs(deltaX) < 48) {
      return;
    }
    if (deltaX < 0) {
      goToPair(pairIndex + 1);
    } else {
      goToPair(pairIndex - 1);
    }
  }

  const regenDisabled =
    busy || aiGenerating || photosLoading || !canRegenerate;

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-w-md">
          <DialogHeader className="min-w-0 overflow-hidden pr-6">
            <DialogTitle className="truncate" title={title}>
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="truncate font-mono">
                {description}
              </DialogDescription>
            ) : (
              <DialogDescription className="sr-only">
                Review original and edited photos
              </DialogDescription>
            )}
          </DialogHeader>

          {showViewTabs ? (
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  activeView === "original"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600",
                )}
                onClick={() => onActiveViewChange("original")}
                type="button"
              >
                Original
              </button>
              <button
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  activeView === "ai"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600",
                )}
                disabled={aiTabDisabled}
                onClick={() => onActiveViewChange("ai")}
                type="button"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI
              </button>
            </div>
          ) : null}

          <div
            className="relative aspect-square w-full overflow-hidden rounded-xl bg-slate-100"
            onTouchEnd={handleTouchEnd}
            onTouchStart={handleTouchStart}
          >
            {photosLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm font-medium">Loading photos…</span>
              </div>
            ) : displayUrl ? (
              <img
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                src={displayUrl}
              />
            ) : activeView === "ai" && aiGenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm font-medium">Generating AI photo…</span>
              </div>
            ) : activeView === "ai" && aiFailed ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-red-600">
                <AlertCircle className="h-8 w-8" />
                <span className="text-sm font-medium">
                  {aiError ?? "AI photo generation failed."}
                </span>
              </div>
            ) : activeView === "ai" && aiAbsent ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-slate-500">
                <Sparkles className="h-8 w-8" />
                <span className="text-sm font-medium">
                  No AI photo yet. Tap Regen to generate one.
                </span>
              </div>
            ) : onEmptyOriginalClick ? (
              <button
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={emptyOriginalDisabled || busy}
                onClick={onEmptyOriginalClick}
                type="button"
              >
                <Camera className="h-8 w-8" />
                <span className="text-sm font-medium">
                  {emptyOriginalLabel ?? "Take photo"}
                </span>
              </button>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                No photo
              </div>
            )}

            {previewBadge && previewUrl ? (
              <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {previewBadge}
              </span>
            ) : null}
            {pairPositionLabel && !previewUrl ? (
              <span className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {pairPositionLabel}
              </span>
            ) : null}
            {activeView === "ai" && aiModelLabel && displayUrl && !previewUrl ? (
              <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white backdrop-blur">
                {aiModelLabel}
              </span>
            ) : null}
            {activeView === "ai" && aiGenerating && displayUrl ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Loader2 className="h-8 w-8 animate-spin text-white" />
              </div>
            ) : null}

            {canNavigatePairs ? (
              <>
                <button
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-40"
                  disabled={pairIndex <= 0 || busy}
                  onClick={() => goToPair(pairIndex - 1)}
                  type="button"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:opacity-40"
                  disabled={pairIndex >= pairCount - 1 || busy}
                  onClick={() => goToPair(pairIndex + 1)}
                  type="button"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </div>

          {canNavigatePairs ? (
            <div className="flex items-center justify-center gap-1.5">
              {Array.from({ length: pairCount }, (_, index) => (
                <button
                  aria-label={`Photo ${index + 1}`}
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors",
                    index === pairIndex ? "bg-slate-700" : "bg-slate-300",
                  )}
                  key={index}
                  onClick={() => goToPair(index)}
                  type="button"
                />
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="text-sm font-medium text-red-600">{error}</p>
          ) : null}
          {stage ? (
            <p className="text-sm font-medium text-slate-600">{stage}</p>
          ) : null}
          {notice ? <p className="text-sm text-slate-500">{notice}</p> : null}

          <DialogFooter className="flex flex-row flex-nowrap items-center gap-1.5 overflow-x-auto sm:justify-start">
            {footerOverride ? (
              footerOverride
            ) : activeView === "ai" ? (
              <>
                <Button
                  className={FOOTER_BUTTON_CLASS}
                  disabled={busy || aiGenerating || photosLoading}
                  onClick={onOpenPrompt}
                  variant="outline"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Prompt
                </Button>
                <Button
                  className={FOOTER_BUTTON_CLASS}
                  disabled={regenDisabled}
                  onClick={() => {
                    if (suppressRegenClickRef.current) {
                      suppressRegenClickRef.current = false;
                      return;
                    }
                    onRegenerate();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (regenDisabled) {
                      return;
                    }
                    openRegenModelMenu(event.clientX, event.clientY);
                  }}
                  onPointerCancel={clearRegenLongPressTimer}
                  onPointerDown={(event) => {
                    if (event.pointerType !== "touch" || regenDisabled) {
                      return;
                    }
                    clearRegenLongPressTimer();
                    const { clientX, clientY } = event;
                    regenLongPressTimerRef.current = window.setTimeout(() => {
                      regenLongPressTimerRef.current = null;
                      triggerHaptic();
                      openRegenModelMenu(clientX, clientY, true);
                    }, REGEN_LONG_PRESS_MS);
                  }}
                  onPointerLeave={clearRegenLongPressTimer}
                  onPointerUp={clearRegenLongPressTimer}
                  variant="outline"
                >
                  {regenerating || aiGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  Regen
                </Button>
                {showWhiten && onWhiten ? (
                  <Button
                    className={FOOTER_BUTTON_CLASS}
                    disabled={busy}
                    onClick={onWhiten}
                    variant="outline"
                  >
                    {whitening ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Whiten
                  </Button>
                ) : null}
                {aiFooterExtra}
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={onPromptDialogOpenChange}
        open={promptDialogOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AI prompt</DialogTitle>
            <DialogDescription>{promptDescription}</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-slate-950/10 focus:ring-2"
            disabled={busy || aiGenerating}
            onChange={(event) => onDraftPromptChange(event.currentTarget.value)}
            value={draftPrompt}
          />
          <DialogFooter>
            <Button
              className="sm:mr-auto"
              disabled={
                busy ||
                aiGenerating ||
                draftPrompt.trim() === defaultPrompt.trim()
              }
              onClick={onUseDefaultPrompt}
              variant="outline"
            >
              Use default
            </Button>
            <Button
              disabled={busy || aiGenerating}
              onClick={() => onPromptDialogOpenChange(false)}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={busy || aiGenerating || !draftPrompt.trim()}
              onClick={onSavePrompt}
            >
              Save prompt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DropdownMenu
        onOpenChange={(menuOpen) => {
          if (!menuOpen) {
            setRegenModelMenu(null);
          }
        }}
        open={regenModelMenu !== null}
      >
        {regenModelMenu ? (
          <DropdownMenuTrigger asChild>
            <span
              className="pointer-events-none fixed h-0 w-0"
              style={{
                left: regenModelMenu.x,
                top: regenModelMenu.y,
              }}
            />
          </DropdownMenuTrigger>
        ) : null}
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {AI_IMAGE_MODEL_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => {
                setRegenModelMenu(null);
                onRegenerate(option.id);
              }}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export { FOOTER_BUTTON_CLASS as photoReviewFooterButtonClass };
