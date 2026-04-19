import { describe, expect, it, mock } from 'bun:test'

// Navigation boundary logic (pure)
describe('ConversationDetail - prev/next boundaries', () => {
  function boundaries(convList: Array<{ id: string }>, currentId: string) {
    const idx = convList.findIndex((c) => c.id === currentId)
    return {
      hasPrev: idx > 0,
      hasNext: idx >= 0 && idx < convList.length - 1,
      idx,
    }
  }

  it('hasPrev=false at first item', () => {
    const { hasPrev } = boundaries([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a')
    expect(hasPrev).toBe(false)
  })

  it('hasNext=false at last item', () => {
    const { hasNext } = boundaries([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'c')
    expect(hasNext).toBe(false)
  })

  it('both true for middle item', () => {
    const { hasPrev, hasNext } = boundaries([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b')
    expect(hasPrev).toBe(true)
    expect(hasNext).toBe(true)
  })

  it('both false for single-item list', () => {
    const { hasPrev, hasNext } = boundaries([{ id: 'only' }], 'only')
    expect(hasPrev).toBe(false)
    expect(hasNext).toBe(false)
  })

  it('prev target is correct', () => {
    const convList = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { idx } = boundaries(convList, 'b')
    expect(convList[idx - 1].id).toBe('a')
  })

  it('next target is correct', () => {
    const convList = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const { idx } = boundaries(convList, 'b')
    expect(convList[idx + 1].id).toBe('c')
  })
})

describe('ConversationDetail - reassign', () => {
  it('calls mutate with selected assignee value', () => {
    const mutate = mock(() => {})
    const onValueChange = (val: string) => {
      if (val) mutate(val)
    }
    onValueChange('staff_1')
    expect(mutate).toHaveBeenCalledWith('staff_1')
  })

  it('does not call mutate for empty string (deselect guard)', () => {
    const mutate = mock(() => {})
    const onValueChange = (val: string) => {
      if (val) mutate(val)
    }
    onValueChange('')
    expect(mutate).not.toHaveBeenCalled()
  })
})
