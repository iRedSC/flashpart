import * as React from "react";
import * as DropdownMenuPrimitives from "@radix-ui/react-dropdown-menu";
import { cn } from "../../lib/utils";

const TOUCH_SLOP_PX = 10;

type DropdownMenuContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(
  null,
);

export function DropdownMenu({
  defaultOpen,
  onOpenChange,
  open: openProp,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  );
  const isControlled = openProp !== undefined;
  const open = openProp ?? uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  const contextValue = React.useMemo(
    () => ({ onOpenChange: handleOpenChange, open }),
    [handleOpenChange, open],
  );

  return (
    <DropdownMenuContext.Provider value={contextValue}>
      <DropdownMenuPrimitives.Root
        {...props}
        onOpenChange={handleOpenChange}
        open={open}
      />
    </DropdownMenuContext.Provider>
  );
}

export const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitives.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Trigger>
>(({ disabled = false, onPointerDown, ...props }, ref) => {
  const context = React.useContext(DropdownMenuContext);
  const contextRef = React.useRef(context);
  contextRef.current = context;

  return (
    <DropdownMenuPrimitives.Trigger
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.pointerType === "touch" && !disabled && context) {
          // Radix opens on pointerdown, which fires while scrolling on touch.
          // Suppress that and open on pointerup instead, but only if the finger
          // did not move enough to count as a scroll.
          event.preventDefault();

          const pointerId = event.pointerId;
          const startX = event.clientX;
          const startY = event.clientY;

          function handleTouchPointerEnd(endEvent: PointerEvent) {
            if (endEvent.pointerId !== pointerId) {
              return;
            }

            document.removeEventListener("pointerup", handleTouchPointerEnd);
            document.removeEventListener(
              "pointercancel",
              handleTouchPointerEnd,
            );

            const moved =
              Math.hypot(
                endEvent.clientX - startX,
                endEvent.clientY - startY,
              ) > TOUCH_SLOP_PX;

            if (!moved) {
              const currentContext = contextRef.current;
              if (currentContext) {
                currentContext.onOpenChange(!currentContext.open);
              }
            }
          }

          document.addEventListener("pointerup", handleTouchPointerEnd);
          document.addEventListener("pointercancel", handleTouchPointerEnd);
        }

        onPointerDown?.(event);
      }}
      ref={ref}
      {...props}
    />
  );
});
DropdownMenuTrigger.displayName = DropdownMenuPrimitives.Trigger.displayName;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitives.Portal>
    <DropdownMenuPrimitives.Content
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-md border border-slate-200 bg-white p-1 text-slate-950 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </DropdownMenuPrimitives.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitives.Content.displayName;

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitives.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitives.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitives.Item
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-slate-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:h-4 [&_svg]:w-4",
      className,
    )}
    ref={ref}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitives.Item.displayName;
