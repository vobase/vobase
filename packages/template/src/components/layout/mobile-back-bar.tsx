import { ChevronLeft } from 'lucide-react'

interface MobileBackBarProps {
  label: string
  onBack: () => void
  ariaLabel?: string
}

function MobileBackBar({ label, onBack, ariaLabel }: MobileBackBarProps) {
  return (
    <div className="flex shrink-0 items-center border-border border-b bg-background px-1">
      <button
        type="button"
        onClick={onBack}
        aria-label={ariaLabel ?? `Back to ${label.toLowerCase()}`}
        className="flex h-9 items-center gap-1 rounded-md px-2 text-muted-foreground text-sm hover:bg-foreground-3 hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        <span>{label}</span>
      </button>
    </div>
  )
}

export type { MobileBackBarProps }
export { MobileBackBar }
