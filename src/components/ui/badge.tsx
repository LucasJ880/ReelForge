import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-data font-medium uppercase tracking-wide text-foreground before:size-1.5 before:rounded-(--radius-sm) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:stroke-[1.5]",
  {
    variants: {
      variant: {
        default: "text-accent before:bg-accent",
        secondary: "text-muted-foreground before:bg-muted-foreground",
        destructive: "text-danger before:bg-danger",
        success: "text-success before:bg-success",
        warning: "text-gold before:bg-gold",
        outline: "before:bg-foreground",
        ghost: "text-muted-foreground before:bg-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
