import { createContext, use } from 'react'
import type { ChannelId, CurvePoint, Curves } from './curves'

/**
 * Shared editor state. For now it holds the live adjustment values; the canvas
 * and other panels will read from the same store as the app grows.
 */
export interface EditorState {
  /** Current adjustment values, keyed by `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Current tone-curve control points, keyed by channel. */
  curves: Curves
  /** Updates a single adjustment value. */
  setAdjustment: (key: string, value: number) => void
  /** Replaces the control points of one curve channel. */
  setCurve: (channel: ChannelId, points: CurvePoint[]) => void
  /** Restores every curve channel to the identity line. */
  resetCurves: () => void
}

export const EditorContext = createContext<EditorState | null>(null)

/**
 * Accesses the editor store. Must be called inside an `EditorProvider`.
 *
 * @throws if used outside of an `EditorProvider`.
 */
export function useEditor(): EditorState {
  const context = use(EditorContext)
  if (context === null) {
    throw new Error('useEditor must be used within an EditorProvider')
  }
  return context
}
