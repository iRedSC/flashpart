import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

type DescriptionFieldProps = {
  "aria-label": string;
  className?: string;
  onNavigateNext?: () => void;
  onOpenChange?: (open: boolean) => void;
  onSave: (value: string) => void;
  open?: boolean;
  placeholder?: string;
  value: string;
};

function normalizeDescription(value: string) {
  return value.trim();
}

const triggerClassName =
  "flex h-8 w-full min-w-0 items-center rounded-md border border-transparent bg-transparent px-1.5 text-left text-[0.8125rem] transition-colors hover:border-slate-200 hover:bg-white/80 focus-visible:border-slate-950 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950";

export function DescriptionField({
  "aria-label": ariaLabel,
  className,
  onNavigateNext,
  onOpenChange,
  onSave,
  open: openProp,
  placeholder = "Add description…",
  value,
}: DescriptionFieldProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const isNavigatingRef = React.useRef(false);
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [position, setPosition] = React.useState({
    height: 32,
    left: 0,
    top: 0,
    width: 0,
  });

  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalOpen(next);
      }
    },
    [isControlled, onOpenChange],
  );

  React.useEffect(() => {
    if (!open) {
      setDraft(value);
    }
  }, [open, value]);

  const updatePosition = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setPosition({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
  }, []);

  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const valueRef = React.useRef(value);
  valueRef.current = value;

  const saveIfChanged = React.useCallback(() => {
    if (
      normalizeDescription(draftRef.current) !==
      normalizeDescription(valueRef.current)
    ) {
      onSave(normalizeDescription(draftRef.current));
    }
  }, [onSave]);

  const closeEditor = React.useCallback(
    (save: boolean) => {
      setOpen(false);

      if (save) {
        saveIfChanged();
      } else {
        setDraft(valueRef.current);
      }
    },
    [saveIfChanged, setOpen],
  );

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    textareaRef.current?.focus();
    const length = textareaRef.current?.value.length ?? 0;
    textareaRef.current?.setSelectionRange(length, length);

    function handleScrollOrResize() {
      updatePosition();
    }

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }

      closeEditor(true);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeEditor, open]);

  function handleNavigateNext() {
    saveIfChanged();
    isNavigatingRef.current = true;
    setOpen(false);
    onNavigateNext?.();
  }

  function handleTextareaKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleNavigateNext();
    }
  }

  function handleTextareaBlur() {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }

    closeEditor(true);
  }

  const displayValue = value.trim();
  const isEmpty = !displayValue;

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={cn(
          triggerClassName,
          isEmpty ? "text-slate-400" : "truncate text-slate-500",
          open && "invisible",
          className,
        )}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="truncate">{isEmpty ? placeholder : displayValue}</span>
      </button>
      {open
        ? createPortal(
            <div
              className="fixed z-50 overflow-hidden rounded-md border border-slate-950 bg-white shadow-lg ring-1 ring-slate-950"
              onMouseDown={(event) => event.preventDefault()}
              ref={popoverRef}
              role="dialog"
              style={{
                left: `${position.left}px`,
                minHeight: `${position.height}px`,
                top: `${position.top}px`,
                width: `${position.width}px`,
              }}
            >
              <textarea
                aria-label={ariaLabel}
                className="block min-h-24 w-full resize-y border-0 bg-white px-1.5 py-1.5 text-[0.8125rem] leading-snug text-slate-500 outline-none placeholder:text-slate-400"
                onBlur={handleTextareaBlur}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder={placeholder}
                ref={textareaRef}
                rows={3}
                style={{ minHeight: `${Math.max(position.height, 96)}px` }}
                value={draft}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
