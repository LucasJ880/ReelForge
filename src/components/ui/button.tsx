import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex h-(--control-height) shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border text-body font-semibold transition-[background-color,border-color,color,transform] duration-fast ease-out select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
  {
    variants: {
      variant: {
        default:
          /// 2026-10-28 学 LibTV：主行动是白色实心胶囊、深字（信号青只留给数据与当前项）
          "border-foreground bg-foreground text-background hover:opacity-90",
        outline:
          "border-border-strong bg-transparent text-foreground hover:border-border-bright hover:bg-raised aria-expanded:border-border-bright",
        secondary:
          "border-border bg-raised text-secondary-foreground hover:border-border-strong",
        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-raised",
        destructive:
          "border-danger bg-danger-soft text-danger hover:bg-danger hover:text-primary-foreground",
        link: "border-transparent bg-transparent text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "px-(--control-padding-inline)",
        xs: "px-3",
        sm: "px-3",
        lg: "px-5",
        icon: "w-(--control-height) px-0",
        "icon-xs": "w-(--control-height) px-0",
        "icon-sm": "w-(--control-height) px-0",
        "icon-lg": "w-(--control-height) px-0",
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
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      nativeButton={nativeButton ?? !render}
      render={render}
      {...props}
    />
  )
}

export { Button, buttonVariants }
