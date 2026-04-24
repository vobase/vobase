type LogLevel = 'info' | 'warn' | 'error' | 'debug'

function log(level: LogLevel, msg: string, data?: unknown): void {
  if (level === 'debug' && !Bun.env.DEBUG && process.env.NODE_ENV === 'production') return
  console.log(JSON.stringify({ level, msg, data, ts: Date.now() }))
}

export const logger = {
  info: (msg: string, data?: unknown) => log('info', msg, data),
  warn: (msg: string, data?: unknown) => log('warn', msg, data),
  error: (msg: string, data?: unknown) => log('error', msg, data),
  debug: (msg: string, data?: unknown) => log('debug', msg, data),
}
