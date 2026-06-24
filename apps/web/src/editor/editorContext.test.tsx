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

  it('resets every adjustment back to its default', () => {
    const { result } = renderHook(() => useEditor(), { wrapper: EditorProvider })

    act(() => result.current.setAdjustment('exposure', 1.2))
    act(() => result.current.resetAdjustments())

    expect(result.current.adjustments.exposure).toBe(0)
  })
})
