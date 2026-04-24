import { describe, expect, it } from 'bun:test'

import { createSteerQueue } from './steer-queue'

describe('createSteerQueue', () => {
  it('drain returns empty array when nothing pushed', () => {
    const q = createSteerQueue()
    expect(q.drain()).toEqual([])
  })

  it('drain returns pushed items in insertion order', () => {
    const q = createSteerQueue()
    q.push('first')
    q.push('second')
    q.push('third')
    expect(q.drain()).toEqual(['first', 'second', 'third'])
  })

  it('drain clears the queue — second drain returns empty', () => {
    const q = createSteerQueue()
    q.push('hello')
    q.drain()
    expect(q.drain()).toEqual([])
  })

  it('push after drain works as a fresh accumulation', () => {
    const q = createSteerQueue()
    q.push('a')
    q.drain()
    q.push('b')
    q.push('c')
    expect(q.drain()).toEqual(['b', 'c'])
  })
})
