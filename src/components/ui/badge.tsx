import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-[var(--app-subtle-bg)] text-[var(--app-fg)]",
        success: "bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)] border border-[var(--app-badge-success-border)]",
        warning: "bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)] border border-[var(--app-badge-warning-border)]",
        error: "bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)] border border-[var(--app-badge-error-border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
