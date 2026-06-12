import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

type DescriptionFieldProps = {
  "aria-label": string;
  className?: string;
  onSave: (value: string) => void;
  placeholder?: string;
  value: string;
};

function normalizeDescription(value: string) {
  return value.trim();
}

export function DescriptionField({
  "aria-label": ariaLabel,
  className,
  onSave,
  placeholder = "Add description…",
  value,
}: DescriptionFieldProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [position, setPosition] = React.useState({
    left: 0,
    top: 0,
    width: 280,
  });

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const updatePosition = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const width = Math.max(rect.width, 280);
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    const top = rect.bottom + 4;

    setPosition({ left, top, width });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }

    updatePosition();
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length,
    );

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

  const draftRef = React.useRef(draft);
  draftRef.current = draft;

  const valueRef = React.useRef(value);
  valueRef.current = value;

  const closeEditor = React.useCallback((save: boolean) => {
    setOpen(false);

    if (
      save &&
      normalizeDescription(draftRef.current) !==
        normalizeDescription(valueRef.current)
    ) {
      onSave(normalizeDescription(draftRef.current));
    } else {
      setDraft(valueRef.current);
    }
  }, [onSave]);

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

  const displayValue = value.trim();
  const isEmpty = !displayValue;

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={cn(
          "flex h-8 w-full min-w-0 items-center rounded-md border border-transparent bg-transparent px-1.5 text-left text-[0.8125rem] transition-colors hover:border-slate-200 hover:bg-white/80 focus-visible:border-slate-950 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950",
          isEmpty ? "text-slate-400" : "truncate text-slate-500",
          open && "border-slate-950 bg-white ring-1 ring-slate-950",
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
              className="fixed z-50 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
              onMouseDown={(event) => event.preventDefault()}
              ref={popoverRef}
              role="dialog"
              style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                width: `${position.width}px`,
              }}
            >
              <textarea
                aria-label={ariaLabel}
                className="min-h-24 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-950 outline-none focus-visible:border-slate-950 focus-visible:ring-1 focus-visible:ring-slate-950"
                onBlur={() => closeEditor(true)}
                onChange={(event) => setDraft(event.currentTarget.value)}
                placeholder={placeholder}
                ref={textareaRef}
                rows={4}
                value={draft}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
