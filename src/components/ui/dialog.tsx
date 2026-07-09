import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useIsMobile } from "../../lib/use-is-mobile";
import { useVisualViewportKeyboard } from "../../lib/use-visual-viewport-keyboard";
import { cn } from "../../lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/50",
      className,
    )}
    ref={ref}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

function scrollFocusedFieldIntoView(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
  ) {
    return;
  }

  // Wait for the keyboard + visualViewport inset to settle, then keep the field visible.
  window.setTimeout(() => {
    target.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  }, 300);
}

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onFocusCapture, style, ...props }, ref) => {
  const isMobile = useIsMobile();
  const keyboard = useVisualViewportKeyboard(isMobile);
  const keyboardOpen = keyboard.inset > 0;

  const mobileStyle = isMobile
    ? {
        bottom: keyboard.inset,
        maxHeight: keyboard.visibleHeight
          ? `${Math.min(keyboard.visibleHeight * 0.9, keyboard.visibleHeight)}px`
          : undefined,
      }
    : undefined;

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "z-50 grid w-full gap-4 border border-slate-200 bg-white p-6 shadow-lg",
          isMobile
            ? [
                "fixed inset-x-0 bottom-0 top-auto",
                "translate-x-0 translate-y-0 overflow-y-auto overscroll-contain",
                "rounded-t-2xl rounded-b-none",
                keyboardOpen
                  ? "pb-6"
                  : "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
              ]
            : [
                "fixed left-1/2 top-1/2 max-h-[min(85dvh,100%)] max-w-lg",
                "-translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain",
                "rounded-xl",
              ],
          className,
          // Keep mobile sheets full-bleed even when callers pass max-w-*.
          isMobile && "max-w-none",
        )}
        onFocusCapture={(event) => {
          onFocusCapture?.(event);
          if (!event.defaultPrevented) {
            scrollFocusedFieldIntoView(event.target);
          }
        }}
        ref={ref}
        style={{ ...mobileStyle, ...style }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 text-left", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    ref={ref}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-slate-500", className)}
    ref={ref}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
