import * as React from "react"

import { cn } from "@/lib/utils"

function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[0.625rem] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function KbdGroup({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
