import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const inputVariants = cva(
  "flex h-10 w-full rounded-md px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2",
        ghost:
          "border border-transparent bg-transparent shadow-none hover:border-slate-200 hover:bg-white/80 focus-visible:border-slate-950 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-slate-950 focus-visible:ring-offset-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, ...props }, ref) => {
    return (
      <input
        className={cn(inputVariants({ variant }), className)}
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
