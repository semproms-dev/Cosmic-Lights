import { createContext, useContext } from 'react'

/**
 * Shared editor state. For now it holds the live adjustment values; the canvas
 * and other panels will read from the same store as the app grows.
 */
export interface EditorState {
  /** Current adjustment values, keyed by `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Updates a single adjustment value. */
  setAdjustment: (key: string, value: number) => void
  /** Restores every adjustment to its default value. */
  resetAdjustments: () => void
}

export const EditorContext = createContext<EditorState | null>(null)

/**
 * Accesses the editor store. Must be called inside an `EditorProvider`.
 *
 * @throws if used outside of an `EditorProvider`.
 */
export function useEditor(): EditorState {
  const context = useContext(EditorContext)
  if (context === null) {
    throw new Error('useEditor must be used within an EditorProvider')
  }
  return context
}
