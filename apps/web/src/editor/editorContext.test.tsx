import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EditorProvider } from './EditorProvider'
import { useEditor } from './editorContext'

describe('useEditor', () => {
  it('throws when used outside an EditorProvider', () => {
    expect(() => renderHook(() => useEditor())).toThrow(/EditorProvider/)
  })

  it('seeds adjustments from the slider defaults', () => {
    const { result } = renderHook(() => useEditor(), { wrapper: EditorProvider })

    expect(result.current.adjustments.exposure).toBe(0)
    expect(result.current.adjustments.contrast).toBe(0)
  })

  it('updates a single adjustment without touching the others', () => {
    const { result } = renderHook(() => useEditor(), { wrapper: EditorProvider })

    act(() => result.current.setAdjustment('exposure', 1.2))

    expect(result.current.adjustments.exposure).toBe(1.2)
    expect(result.current.adjustments.contrast).toBe(0)
  })

  it('seeds every curve channel with the identity line', () => {
    const { result } = renderHook(() => useEditor(), { wrapper: EditorProvider })

    expect(result.current.curves.rgb).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
  })

  it('replaces the points of one curve channel without touching the others', () => {
    const { result } = renderHook(() => useEditor(), { wrapper: EditorProvider })

    act(() =>
      result.current.setCurve('rgb', [
        { x: 0, y: 0 },
        { x: 128, y: 200 },
        { x: 255, y: 255 },
      ]),
    )

    expect(result.current.curves.rgb).toHaveLength(3)
    expect(result.current.curves.red).toHaveLength(2)
  })

  it('resets the curves back to the identity line', () => {
    const { result } = renderHook(() => useEditor(), { wrapper: EditorProvider })

    act(() =>
      result.current.setCurve('rgb', [
        { x: 0, y: 0 },
        { x: 128, y: 200 },
        { x: 255, y: 255 },
      ]),
    )
    act(() => result.current.resetCurves())

    expect(result.current.curves.rgb).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
  })
})
