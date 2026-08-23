import { describe, expect, it } from 'vitest'
import {
  addPhotos,
  addToStack,
  createLibrary,
  createStack,
  removeFromStack,
  reorderInStack,
  setKeyPhoto,
  stackOf,
  toggleCollapsed,
  unstackAll,
  updatePhoto,
  visibleItems,
} from './library'
import type { Library, Photo } from './library'

/** A minimal photo; only the id matters to the model. */
const photo = (id: string): Photo => ({
  id,
  fileName: `${id}.raf`,
  thumbUrl: null,
  captureTime: null,
})

/** A library holding the given photos, in order. */
const libWith = (...ids: string[]): Library => addPhotos(createLibrary(), ids.map(photo))

describe('library — addPhotos', () => {
  it('registers photos in order', () => {
    const library = libWith('a', 'b')
    expect([...library.photos.keys()]).toEqual(['a', 'b'])
  })

  it('skips ids that are already registered', () => {
    // Re-importing the same selection must not duplicate or reset entries.
    const library = libWith('a', 'b')
    const next = addPhotos(library, [photo('b'), photo('c')])
    expect([...next.photos.keys()]).toEqual(['a', 'b', 'c'])
  })

  it('never mutates its input', () => {
    const library = libWith('a')
    addPhotos(library, [photo('b')])
    expect([...library.photos.keys()]).toEqual(['a'])
  })
})

describe('library — updatePhoto', () => {
  it('patches the enrichment fields of one photo', () => {
    const library = libWith('a', 'b')
    const next = updatePhoto(library, 'a', { thumbUrl: 'data:x', captureTime: 5 })

    expect(next.photos.get('a')).toMatchObject({ thumbUrl: 'data:x', captureTime: 5 })
    expect(next.photos.get('b')?.captureTime).toBeNull()
  })

  it('ignores null patch values instead of erasing stored ones', () => {
    // A later enrichment pass that finds nothing must not undo an earlier one.
    const library = updatePhoto(libWith('a'), 'a', { captureTime: 9 })
    const next = updatePhoto(library, 'a', { thumbUrl: null, captureTime: null })
    expect(next.photos.get('a')?.captureTime).toBe(9)
  })

  it('is a no-op when nothing changes', () => {
    const library = libWith('a')
    expect(updatePhoto(library, 'a', {})).toBe(library)
    expect(updatePhoto(library, 'a', { thumbUrl: null })).toBe(library)
  })

  it('rejects an unknown photo', () => {
    expect(() => updatePhoto(libWith('a'), 'nope', { captureTime: 1 })).toThrow(/Unknown photo/)
  })
})

describe('library — createStack', () => {
  it('groups photos into a collapsed stack keyed on the first one', () => {
    const library = createStack(libWith('a', 'b', 'c'), ['a', 'c'])
    expect(library.stacks.size).toBe(1)

    const stack = [...library.stacks.values()][0]
    expect(stack.photoIds).toEqual(['a', 'c'])
    expect(stack.keyPhotoId).toBe('a')
    expect(stack.collapsed).toBe(true)
  })

  it('pulls members out of their previous stacks', () => {
    // Invariant 1: a photo lives in at most one stack, so restacking is a move.
    const first = createStack(libWith('a', 'b', 'c', 'd'), ['a', 'b'])
    const second = createStack(first, ['b', 'c'])

    expect(stackOf(second, 'b')?.photoIds).toEqual(['b', 'c'])
    // The old stack lost its last remaining member and dissolved (invariant 2).
    expect(stackOf(second, 'a')).toBeNull()
  })

  it('dissolves a previous stack left with a single member', () => {
    const first = createStack(libWith('a', 'b', 'c'), ['a', 'b'])
    const second = createStack(first, ['a', 'c'])
    // `b` was left alone when `a` moved away.
    expect(stackOf(second, 'b')).toBeNull()
  })

  it('rejects fewer than two distinct photos', () => {
    const library = libWith('a')
    expect(() => createStack(library, ['a'])).toThrow()
    expect(() => createStack(library, ['a', 'a'])).toThrow()
  })

  it('rejects unknown photo ids', () => {
    const library = libWith('a', 'b')
    expect(() => createStack(library, ['a', 'nope'])).toThrow(/Unknown photo/)
  })
})

describe('library — addToStack', () => {
  it('appends in the order given and detaches from other stacks', () => {
    const stacked = createStack(libWith('a', 'b', 'c', 'd'), ['a', 'b'])
    const next = addToStack(stacked, stackIdOf(stacked), ['c', 'd'])

    const stack = stackOf(next, 'a')
    expect(stack?.photoIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores photos that are already members', () => {
    // Re-adding must not reorder, and a pure no-op returns the same reference.
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    const next = addToStack(stacked, stackIdOf(stacked), ['a'])
    expect(next).toBe(stacked)
  })

  it('rejects an unknown stack', () => {
    const library = libWith('a', 'b')
    expect(() => addToStack(library, 'nope', ['a'])).toThrow(/Unknown stack/)
  })

  it('rejects unknown photo ids', () => {
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    expect(() => addToStack(stacked, stackIdOf(stacked), ['nope'])).toThrow(/Unknown photo/)
  })
})

describe('library — removeFromStack', () => {
  it('removes membership but keeps the photo in the library', () => {
    const stacked = createStack(libWith('a', 'b', 'c'), ['a', 'b', 'c'])
    const next = removeFromStack(stacked, 'b')

    expect(stackOf(next, 'b')).toBeNull()
    expect(stackOf(next, 'a')?.photoIds).toEqual(['a', 'c'])
    expect(next.photos.has('b')).toBe(true)
  })

  it('promotes the top member when the key photo leaves', () => {
    const stacked = createStack(libWith('a', 'b', 'c'), ['a', 'b', 'c'])
    const next = removeFromStack(stacked, 'a')

    const stack = stackOf(next, 'b')
    expect(stack?.keyPhotoId).toBe('b')
  })

  it('dissolves the stack when a single member remains', () => {
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    const next = removeFromStack(stacked, 'a')

    expect(next.stacks.size).toBe(0)
    expect(next.photos.has('b')).toBe(true)
  })

  it('is a no-op for an unstacked photo', () => {
    const library = libWith('a', 'b')
    const next = removeFromStack(library, 'a')
    expect(next).toBe(library)
  })

  it('rejects an unknown photo', () => {
    const library = libWith('a', 'b')
    expect(() => removeFromStack(library, 'nope')).toThrow(/Unknown photo/)
  })
})

describe('library — unstackAll', () => {
  it('frees every member and drops the stack', () => {
    const stacked = createStack(libWith('a', 'b', 'c'), ['a', 'b', 'c'])
    const next = unstackAll(stacked, stackIdOf(stacked))

    expect(next.stacks.size).toBe(0)
    for (const id of ['a', 'b', 'c']) {
      expect(stackOf(next, id)).toBeNull()
      expect(next.photos.has(id)).toBe(true)
    }
  })

  it('leaves other stacks alone', () => {
    const both = createStack(createStack(libWith('a', 'b', 'c', 'd'), ['a', 'b']), ['c', 'd'])
    // Insertion order makes stackIdOf return the a+b stack.
    const next = unstackAll(both, stackIdOf(both))
    expect(next.stacks.size).toBe(1)
    expect(stackOf(next, 'a')).toBeNull()
    expect(stackOf(next, 'c')?.photoIds).toEqual(['c', 'd'])
  })

  it('rejects an unknown stack', () => {
    const library = libWith('a', 'b')
    expect(() => unstackAll(library, 'nope')).toThrow(/Unknown stack/)
  })
})

describe('library — toggleCollapsed', () => {
  it('flips the flag both ways', () => {
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    const id = stackIdOf(stacked)

    const expanded = toggleCollapsed(stacked, id)
    expect(expanded.stacks.get(id)?.collapsed).toBe(false)

    const recollapsed = toggleCollapsed(expanded, id)
    expect(recollapsed.stacks.get(id)?.collapsed).toBe(true)
  })

  it('rejects an unknown stack', () => {
    const library = libWith('a', 'b')
    expect(() => toggleCollapsed(library, 'nope')).toThrow(/Unknown stack/)
  })
})

describe('library — reorderInStack', () => {
  const stacked = createStack(libWith('a', 'b', 'c'), ['a', 'b', 'c'])

  it('moves a member to the requested index', () => {
    const next = reorderInStack(stacked, stackIdOf(stacked), 'c', 0)
    expect(stackOf(next, 'a')?.photoIds).toEqual(['c', 'a', 'b'])
  })

  it('clamps out-of-range indices instead of throwing', () => {
    // Drag handlers pass raw drop positions; clamping keeps them honest.
    const low = reorderInStack(stacked, stackIdOf(stacked), 'b', -5)
    expect(stackOf(low, 'a')?.photoIds).toEqual(['b', 'a', 'c'])

    const high = reorderInStack(stacked, stackIdOf(stacked), 'b', 99)
    expect(stackOf(high, 'a')?.photoIds).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op when the position does not change', () => {
    const next = reorderInStack(stacked, stackIdOf(stacked), 'b', 1)
    expect(next).toBe(stacked)
  })

  it('rejects a photo that is not a member', () => {
    expect(() => reorderInStack(stacked, stackIdOf(stacked), 'x', 0)).toThrow(/not in stack/)
  })
})

describe('library — setKeyPhoto', () => {
  it('changes which member represents the collapsed stack', () => {
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    const next = setKeyPhoto(stacked, stackIdOf(stacked), 'b')
    expect(stackOf(next, 'a')?.keyPhotoId).toBe('b')
  })

  it('is a no-op when the photo is already the key', () => {
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    const next = setKeyPhoto(stacked, stackIdOf(stacked), 'a')
    expect(next).toBe(stacked)
  })

  it('rejects a photo that is not a member', () => {
    const stacked = createStack(libWith('a', 'b'), ['a', 'b'])
    expect(() => setKeyPhoto(stacked, stackIdOf(stacked), 'x')).toThrow(/not in stack/)
  })
})

describe('library — visibleItems', () => {
  it('lists unstacked photos as themselves', () => {
    const items = visibleItems(libWith('a', 'b'))
    expect(items.map(item => item.kind)).toEqual(['photo', 'photo'])
  })

  it('shows a collapsed stack once, at the key photo position', () => {
    // Insertion order is a, b, c; the stack of b+c collapses onto b.
    const stacked = createStack(libWith('a', 'b', 'c'), ['b', 'c'])
    const items = visibleItems(stacked)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'photo', photo: { id: 'a' } })
    expect(items[1]).toMatchObject({ kind: 'stack' })
    if (items[1].kind === 'stack') {
      expect(items[1].stack.keyPhotoId).toBe('b')
    }
  })

  it('expands a stack into its individual members', () => {
    const stacked = createStack(libWith('a', 'b', 'c'), ['b', 'c'])
    const expanded = toggleCollapsed(stacked, stackIdOf(stacked))
    const items = visibleItems(expanded)

    expect(items.map(item => item.kind)).toEqual(['photo', 'photo', 'photo'])
  })

  it('keeps every item reachable after mixed operations', () => {
    // Two stacks plus two loose photos; expand one, leave the other collapsed.
    const both = createStack(createStack(libWith('a', 'b', 'c', 'd', 'e', 'f'), ['a', 'b']), ['c', 'd', 'e'])
    // Insertion order makes stackIdOf return the a+b stack, which expands.
    const mixed = toggleCollapsed(both, stackIdOf(both))

    const items = visibleItems(mixed)
    // Expanded a+b → 2 photo items; collapsed c/d/e → 1 stack item; loose f → 1.
    expect(items).toHaveLength(4)
    expect(items.filter(item => item.kind === 'stack')).toHaveLength(1)
  })
})

/** First (and in tests, only) stack id of a library. */
function stackIdOf(library: Library): string {
  const id = [...library.stacks.keys()][0]
  if (id === undefined) throw new Error('test helper: library has no stack')
  return id
}
