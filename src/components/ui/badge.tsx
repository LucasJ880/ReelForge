import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap text-meta font-medium text-foreground before:size-1.5 before:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:stroke-[1.5]",
  {
    variants: {
      variant: {
        default: "before:bg-primary",
        secondary: "text-muted-foreground before:bg-muted-foreground",
        destructive: "before:bg-danger",
        success: "before:bg-success",
        warning: "before:bg-warning",
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
