import { createContext, use, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { CanvasView } from './crop'
import type { ChannelId, CurvePoint, Curves } from './curves'
import type { CropRegion, ImageState, ImageStatus } from './image'
import type {
  BrushSettings,
  BrushStroke,
  DuplicateMaskOptions,
  GradientLine,
  Mask,
  MaskType,
  ObjectPrompt,
  RadialShape,
} from './masks'
import type { Preset } from './presets'
import type { MaskAlphaCache, MaskStatus } from './segmentation/types'
import type { Orientation, TurnDirection } from './rotation'

/**
 * One-shot signal that a 90° rotation was just applied, so the canvas can play
 * the spin animation. Transient view state — never part of the undo history.
 *
 * `id` changes on every rotation (even repeats in the same direction) so the
 * canvas effect re-fires each time; `direction` is which way the user turned.
 */
export interface RotationSpin {
  direction: TurnDirection
  id: number
}

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
  /**
   * Replaces the global develop (sliders + curves) with a preset's. Every slider
   * the preset does not name goes back to its default, so the result matches the
   * panel's thumbnail whatever was set before. Crop, orientation and masks are
   * left alone.
   */
  applyPreset: (preset: Preset) => void
  /** Current crop region in image pixels, or `null` for the full frame. */
  cropRegion: CropRegion | null
  /** Sets (or replaces) the crop region; `null` clears it. */
  setCrop: (region: CropRegion | null) => void
  /** Clears the crop, restoring the full frame. */
  clearCrop: () => void
  /** Selected aspect-ratio label: 'Original' | '1:1' | ... | 'Free'. */
  cropRatio: string
  /** Updates the selected aspect-ratio label. */
  setCropRatio: (ratio: string) => void
  /** Whether the reset-confirmation dialog is open. */
  resetDialogOpen: boolean
  /** Opens the reset-confirmation dialog (from the Canvas menu or a shortcut). */
  openResetDialog: () => void
  /** Closes the reset-confirmation dialog. */
  closeResetDialog: () => void
  /** Reverts to the previous committed checkpoint. No-op when `canUndo` is false. */
  undo: () => void
  /** Reapplies the next checkpoint after an undo. No-op when `canRedo` is false. */
  redo: () => void
  /**
   * Checkpoints the current state as one undo step. Called on gesture end
   * (slider release, curve pointer-up, crop apply). A commit with no change
   * since the last checkpoint is a no-op, so over-calling it is safe.
   */
  commit: () => void
  /** Whether there is a checkpoint to undo back to. */
  canUndo: boolean
  /** Whether there is an undone checkpoint to redo. */
  canRedo: boolean
  /** Local-adjustment masks, oldest first. */
  masks: Mask[]
  /** Id of the selected mask, or `null` if none is selected. */
  activeMaskId: string | null
  /**
   * Creates a mask of the given type (with a unique default name), appends it
   * and selects it. No-op once {@link MAX_MASKS} is reached. Returns the new
   * mask's id, or `null` if the cap blocked it.
   */
  addMask: (type: MaskType) => string | null
  /**
   * Copies an existing mask — geometry, prompt, adjustments and generated alpha
   * alike — under a new id, appends it and selects it.
   *
   * Refuses (returns `null`) when the source is gone, when the cap is reached,
   * or when an AI mask's alpha has not arrived yet: without it the copy would be
   * permanently empty, since only the original's segmentation was ever run.
   *
   * @param id - The mask to copy.
   * @param name - Display name for the copy; the caller translates it.
   * @param options - Which parts to change on the way; a plain copy by default.
   */
  duplicateMask: (id: string, name: string, options?: DuplicateMaskOptions) => string | null
  /** Removes a mask by id; clears the selection if it was the active one. */
  removeMask: (id: string) => void
  /** Selects a mask (or clears the selection with `null`). */
  setActiveMask: (id: string | null) => void
  /** Updates a single adjustment value of one mask. */
  setMaskAdjustment: (id: string, key: string, value: number) => void
  /** Toggles whether a mask affects the area outside its selection. */
  setMaskInvert: (id: string, invert: boolean) => void
  /** Renames a mask. */
  renameMask: (id: string, name: string) => void
  /** Appends a freehand brush stroke to a brush mask. */
  addBrushStroke: (id: string, stroke: BrushStroke) => void
  /**
   * Live brush-tool settings (size/hardness/add-erase). Transient UI state, like
   * {@link maskOverlayHidden}: strokes carry their own copy, so this never
   * belongs in the undo history.
   */
  brush: BrushSettings
  /** Patches the brush settings; unlisted fields keep their current value. */
  setBrush: (patch: Partial<BrushSettings>) => void
  /** Sets (or replaces) the gradient ramp of a `linear` mask. */
  setMaskGradient: (id: string, gradient: GradientLine) => void
  /**
   * Sets the prompt of an `object` mask and re-segments it against the model.
   * Call it on every refinement — each click, shift-click or box — with the
   * **whole** prompt, in normalised [0,1] image coordinates.
   *
   * The first prompt of an image is slow (it encodes the image); the rest only
   * run the mask decoder, so refining feels immediate.
   */
  setObjectPrompt: (id: string, prompt: ObjectPrompt) => void
  /**
   * Whether the red mask overlay is temporarily hidden — set while a mask slider
   * is being dragged so the adjustment is visible, cleared on release.
   */
  maskOverlayHidden: boolean
  /** Shows/hides the mask editing overlay (transient UI state, not undoable). */
  setMaskOverlayHidden: (hidden: boolean) => void
  /**
   * Alphas generated for AI masks, keyed by mask id.
   *
   * A ref, not state: the pixels are heavy and stay out of the undo history.
   * **Mutating it re-renders nothing** — bump the owning mask's `version` to
   * produce the frame that uploads the new alpha. Read `.current` from an effect
   * or a handler, never during render.
   */
  maskAlphas: RefObject<MaskAlphaCache>
  /**
   * Segmentation progress per AI mask, keyed by mask id. Masks with no entry
   * are either hand-painted or have not started.
   */
  maskStatus: Map<string, MaskStatus>
  /**
   * Download progress of the segmentation model, 0..100, or `null` when it is
   * not downloading (already cached, or done). Global: there is one model.
   *
   * A mask that is `loading` while this is `null` is *inferring*, which is the
   * distinction the user needs — the download is slow but happens once, while
   * inference is slow on every request and has no progress to report.
   */
  modelProgress: number | null
  /** Re-runs the segmentation of a failed AI mask. */
  retryMask: (id: string) => void
  /**
   * The canvas' interactive zoom/pan. Transient view state, never undoable.
   *
   * It lives here rather than inside `Canvas` because anything drawn *over* the
   * canvas (the crop overlay) has to undo the same transform to know which image
   * pixel is under the pointer.
   */
  view: CanvasView
  /** Replaces the zoom/pan. Accepts an updater, like `useState`. */
  setView: Dispatch<SetStateAction<CanvasView>>
  /** Giros de 90° y volteos aplicados a la imagen. */
  orientation: Orientation
  /** Gira la imagen 90° en sentido horario. */
  rotateCw: () => void
  /** Gira la imagen 90° en sentido antihorario. */
  rotateCcw: () => void
  /** Espeja lo mostrado izquierda↔derecha. */
  flipH: () => void
  /** Espeja lo mostrado arriba↔abajo. */
  flipV: () => void
  /** Restaura la orientación original. */
  resetOrientation: () => void
  /**
   * Transient signal fired by {@link rotateCw}/{@link rotateCcw} so the canvas
   * can animate the quarter turn. `null` until the first rotation. Not undoable.
   */
  rotationSpin: RotationSpin | null
  setMaskRadial: (id: string, radial: RadialShape) => void;
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
