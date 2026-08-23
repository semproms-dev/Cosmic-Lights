import { describe, expect, it } from 'vitest'
import { autoStackGroups, DEFAULT_AUTO_STACK_GAP_MS } from './autoStack'
import type { Photo } from './library'

/** A photo carrying only what clustering reads: id and capture time. */
const timed = (id: string, captureTime: number | null): Photo => ({
  id,
  fileName: `${id}.raf`,
  thumbUrl: null,
  captureTime,
})

describe('autoStackGroups', () => {
  it('clusters photos taken within the gap into one group', () => {
    // A burst: frames 200 ms apart.
    const groups = autoStackGroups([
      timed('a', 1000),
      timed('b', 1200),
      timed('c', 1400),
    ])
    expect(groups).toEqual([['a', 'b', 'c']])
  })

  it('starts a new group when the silence exceeds the gap', () => {
    const groups = autoStackGroups([
      timed('a', 1000),
      timed('b', 2200),
      timed('c', 5000),
      timed('d', 5100),
    ])
    expect(groups).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('keeps a gap of exactly maxGapMs inside one group', () => {
    // Strictly greater splits; equality does not — the boundary is inclusive.
    const groups = autoStackGroups([timed('a', 0), timed('b', DEFAULT_AUTO_STACK_GAP_MS)])
    expect(groups).toEqual([['a', 'b']])
  })

  it('sorts by time regardless of input order', () => {
    // `late` splits off as a singleton and is dropped, per the grouping rules.
    const groups = autoStackGroups([
      timed('late', 3000),
      timed('early', 0),
      timed('mid', 100),
    ])
    expect(groups).toEqual([['early', 'mid']])
  })

  it('skips photos without a capture time', () => {
    const groups = autoStackGroups([timed('a', null), timed('b', 0), timed('c', 10)])
    expect(groups).toEqual([['b', 'c']])
  })

  it('drops singleton groups — one photo is not a stack', () => {
    const groups = autoStackGroups([
      timed('lone', 0),
      timed('far', 999_999),
    ])
    expect(groups).toEqual([])
  })

  it('returns nothing without photos or times', () => {
    expect(autoStackGroups([])).toEqual([])
    expect(autoStackGroups([timed('a', null), timed('b', null)])).toEqual([])
  })

  it('honours a custom gap', () => {
    // 2 s apart: one group under a generous window; under a tight one the
    // split leaves two singletons, which are dropped entirely.
    const photos = [timed('a', 0), timed('b', 2000)]
    expect(autoStackGroups(photos, 2500)).toEqual([['a', 'b']])
    expect(autoStackGroups(photos, 1999)).toEqual([])
  })
})
