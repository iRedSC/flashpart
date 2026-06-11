import * as React from "react";
import * as DropdownMenuPrimitives from "@radix-ui/react-dropdown-menu";
import { cn } from "../../lib/utils";

export const DropdownMenu = DropdownMenuPrimitives.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitives.Trigger;

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
