/** Per-wake abort coordination carrier — threaded through `BootWakeOpts`. */
export interface AbortContext {
  wakeAbort: AbortController
  reason: string | null
}
