import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-(--radius-md) border text-meta font-semibold transition-[filter,background-color,border-color,color] duration-fast ease-out select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:brightness-[.94]",
        outline:
          "border-border bg-card text-foreground hover:brightness-[.94] aria-expanded:bg-secondary",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:brightness-[.94]",
        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-secondary",
        destructive:
          "border-danger bg-danger text-primary-foreground hover:brightness-[.94]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "px-4",
        xs: "px-3",
        sm: "px-3",
        lg: "px-5",
        icon: "w-10 px-0",
        "icon-xs": "w-10 px-0",
        "icon-sm": "w-10 px-0",
        "icon-lg": "w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
