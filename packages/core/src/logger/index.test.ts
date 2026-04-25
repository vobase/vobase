import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { createLogger, logger } from '.'

describe('logger (default JSON)', () => {
  let logs: string[] = []
  const originalLog = console.log

  beforeEach(() => {
    logs = []
    console.log = (msg: string) => logs.push(msg)
  })

  afterEach(() => {
    console.log = originalLog
  })

  it('logs info with (obj, msg) shape', () => {
    logger.info({ foo: 'bar' }, 'test message')
    expect(logs.length).toBe(1)
    const parsed = JSON.parse(logs[0])
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('test message')
    expect(parsed.data).toEqual({ foo: 'bar' })
    expect(typeof parsed.ts).toBe('number')
  })

  it('logs warn with msg only', () => {
    logger.warn(undefined, 'warning')
    const parsed = JSON.parse(logs[0])
    expect(parsed.level).toBe('warn')
    expect(parsed.msg).toBe('warning')
  })

  it('logs error with obj + msg', () => {
    logger.error({ code: 500 }, 'error occurred')
    const parsed = JSON.parse(logs[0])
    expect(parsed.level).toBe('error')
    expect(parsed.msg).toBe('error occurred')
    expect(parsed.data).toEqual({ code: 500 })
  })

  it('logs debug when DEBUG env is set', () => {
    const oldDebug = Bun.env.DEBUG
    Bun.env.DEBUG = 'true'
    logger.debug({}, 'debug info')
    Bun.env.DEBUG = oldDebug
    expect(logs.length).toBe(1)
    expect(JSON.parse(logs[0]).level).toBe('debug')
  })
})

describe('createLogger', () => {
  let warnSpy: string[] = []
  let errorSpy: string[] = []
  const ow = console.warn
  const oe = console.error

  beforeEach(() => {
    warnSpy = []
    errorSpy = []
    console.warn = (...args: unknown[]) => warnSpy.push(args.map(String).join(' '))
    console.error = (...args: unknown[]) => errorSpy.push(args.map(String).join(' '))
  })

  afterEach(() => {
    console.warn = ow
    console.error = oe
  })

  it('console format with prefix routes to console.<level>', () => {
    const log = createLogger({ format: 'console', prefix: '[wake]' })
    log.warn({ foo: 1 }, 'something')
    log.error({ err: 'bad' }, 'failure')
    expect(warnSpy[0]).toContain('[wake]')
    expect(warnSpy[0]).toContain('something')
    expect(errorSpy[0]).toContain('[wake]')
    expect(errorSpy[0]).toContain('failure')
  })

  it('silent levels are dropped', () => {
    const log = createLogger({ format: 'console', silent: ['warn'] })
    log.warn({}, 'silenced')
    expect(warnSpy.length).toBe(0)
  })
})
