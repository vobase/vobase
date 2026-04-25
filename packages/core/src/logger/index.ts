import type { HarnessLogger } from '../harness/create-harness'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface CreateLoggerOpts {
  /** `'json'` emits one JSON line per call; `'console'` calls `console.<level>`. Default `'json'`. */
  format?: 'json' | 'console'
  /** Prefix prepended to console output. Ignored for `format='json'`. */
  prefix?: string
  /** Levels dropped silently. */
  silent?: readonly LogLevel[]
}

/**
 * Build a `(obj, msg?)`-shape logger (pino convention). Returns a value
 * compatible with `HarnessLogger` so the same factory powers both the harness
 * and general server logging.
 *
 * `format='json'` always drops `debug` in production unless `DEBUG` is set,
 * matching the historical default.
 */
export function createLogger(opts: CreateLoggerOpts = {}): HarnessLogger {
  const silent = new Set<LogLevel>(opts.silent ?? [])
  const format = opts.format ?? 'json'
  const prefix = opts.prefix

  const emit = (level: LogLevel) => {
    if (silent.has(level)) return () => undefined
    if (format === 'json') {
      return (obj: unknown, msg?: string) => {
        if (level === 'debug' && !Bun.env.DEBUG && process.env.NODE_ENV === 'production') return
        console.log(JSON.stringify({ level, msg, data: obj, ts: Date.now() }))
      }
    }
    const sink =
      level === 'error'
        ? console.error
        : level === 'warn'
          ? console.warn
          : level === 'debug'
            ? console.debug
            : console.info
    return prefix
      ? (obj: unknown, msg?: string) => sink(prefix, msg ?? '', obj)
      : (obj: unknown, msg?: string) => sink(msg ?? '', obj)
  }

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  }
}

/** Default logger — JSON lines on `console.log`. Replace via `createLogger(opts)`. */
export const logger: HarnessLogger = createLogger()
