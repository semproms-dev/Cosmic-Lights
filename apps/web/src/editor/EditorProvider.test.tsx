import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EditorProvider } from './EditorProvider'
import { useEditor, type EditorState } from './editorContext'
import { MAX_MASKS } from './masks'
import type { CachedMaskAlpha } from './segmentation/types'

/**
 * A generated alpha, as the segmentation worker would hand one over. Tiny on
 * purpose: these tests care about *which id* it is filed under, never about the
 * pixels.
 */
function fakeAlpha(version = 0): CachedMaskAlpha {
  return { data: new Uint8Array([0, 128, 255, 64]), width: 2, height: 2, version }
}

function renderEditor(): RenderHookResult<EditorState, unknown> {
  return renderHook(() => useEditor(), { wrapper: EditorProvider })
}

describe('EditorProvider · duplicateMask', () => {
  /**
   * Adds a mask and returns its id.
   *
   * Its own `act` on purpose: the action reads `state` from the render closure,
   * so anything that has to *see* this mask must run after React has re-rendered
   * with it.
   *
   * No image is open in these tests, which is what keeps `subject` from reaching
   * for the model — `runSegmentation` returns early with nothing to segment.
   */
  function addMask(result: RenderHookResult<EditorState, unknown>['result'], type: 'brush' | 'subject' | 'object'): string {
    let id: string | null = null
    act(() => {
      id = result.current.addMask(type)
    })
    if (id === null) throw new Error('addMask refused')
    return id
  }

  /** Runs the duplication and hands back whatever it returned. */
  function duplicate(
    result: RenderHookResult<EditorState, unknown>['result'],
    ...args: Parameters<EditorState['duplicateMask']>
  ): string | null {
    let copyId: string | null = null
    act(() => {
      copyId = result.current.duplicateMask(...args)
    })
    return copyId
  }

  it('copies a generated alpha under the new id', () => {
    // The bug this guards: alphas are keyed by mask id and the copy has a fresh
    // one, so an `object` mask — whose pixels came from a prompted model run,
    // not from geometry it could rebuild — used to render permanently empty.
    const { result } = renderEditor()
    const id = addMask(result, 'object')
    act(() => {
      result.current.maskAlphas.current.set(id, fakeAlpha())
    })

    const copyId = duplicate(result, id, 'copy')

    expect(copyId).not.toBeNull()
    const copied = result.current.maskAlphas.current.get(copyId ?? '')
    expect(copied?.data).toEqual(fakeAlpha().data)
    // The original keeps its own entry: this is a copy, not a hand-off.
    expect(result.current.maskAlphas.current.get(id)).toBeDefined()
  })

  it('refuses an AI mask whose alpha has not arrived yet', () => {
    // Nothing would ever fill the copy's cache entry — only the original's
    // segmentation was ever requested — so it would be a mask that can never
    // render. Better to add nothing than to hand back a dead one.
    const { result } = renderEditor()
    const id = addMask(result, 'subject')

    expect(duplicate(result, id, 'copy')).toBeNull()
    expect(result.current.masks).toHaveLength(1)
  })

  it('duplicates a hand-painted mask without needing any alpha', () => {
    // A brush mask rasterises from the strokes the copy already carries, so it
    // rebuilds itself and never consults the cache.
    const { result } = renderEditor()
    const id = addMask(result, 'brush')

    expect(duplicate(result, id, 'Brush 1 (copy)')).not.toBeNull()
    expect(result.current.masks).toHaveLength(2)
    expect(result.current.masks[1].name).toBe('Brush 1 (copy)')
    expect(result.current.masks[1].id).not.toBe(id)
  })

  it('passes the options through to the copy', () => {
    const { result } = renderEditor()
    const id = addMask(result, 'brush')
    act(() => {
      result.current.setMaskAdjustment(id, 'exposure', 1.5)
    })

    duplicate(result, id, 'copy', { invert: true, resetAdjustments: true })

    const copy = result.current.masks[1]
    expect(copy.invert).toBe(true)
    expect(copy.adjustments.exposure).toBe(0)
    // The original is untouched by its own duplication.
    expect(result.current.masks[0].adjustments.exposure).toBe(1.5)
  })

  it('refuses an id that is not there', () => {
    const { result } = renderEditor()

    expect(duplicate(result, 'no-such-mask', 'copy')).toBeNull()
    expect(result.current.masks).toHaveLength(0)
  })

  it('respects the mask cap', () => {
    const { result } = renderEditor()
    const first = addMask(result, 'brush')
    for (let i = 1; i < MAX_MASKS; i += 1) addMask(result, 'brush')
    expect(result.current.masks).toHaveLength(MAX_MASKS)

    expect(duplicate(result, first, 'copy')).toBeNull()
    expect(result.current.masks).toHaveLength(MAX_MASKS)
  })
})
