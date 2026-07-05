import { createContext, use } from 'react'
import type { ChannelId, CurvePoint, Curves } from './curves'
import type { CropRegion, ImageState, ImageStatus } from './image'

/**
 * Shared editor state. For now it holds the live adjustment values; the canvas
 * and other panels will read from the same store as the app grows.
 */
export interface EditorState {
  /** Current adjustment values, keyed by `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Current tone-curve control points, keyed by channel. */
  curves: Curves
  /** Decoded RAW image ready to draw, or `null` if none is open. */
  image: ImageState
  /** Load/decode status of the current image. */
  imageStatus: ImageStatus
  /** Whether the current image has unsaved changes. */
  imageDirty: boolean
  /** Decodes a RAW file and stores it for the canvas to draw. */
  loadImage: (file: File) => Promise<void>
  /** Updates a single adjustment value. */
  setAdjustment: (key: string, value: number) => void
  /** Replaces the control points of one curve channel. */
  setCurve: (channel: ChannelId, points: CurvePoint[]) => void
  /** Restores every curve channel to the identity line. */
  resetCurves: () => void
  /** Resets all the adjustements */
  resetAdjustements: () => void
  /** Current crop region in image pixels, or `null` for the full frame. */
  cropRegion: CropRegion | null
  /** Sets (or replaces) the crop region; `null` clears it. */
  setCrop: (region: CropRegion | null) => void
  /** Clears the crop, restoring the full frame. */
  clearCrop: () => void
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
