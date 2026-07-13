import { basicAdjustments, buildDefaults, colorAdjustement } from './adjustments'

/**
 * How a mask's alpha map is produced. All three resolve to the same thing — a
 * single-channel weight per pixel — but differ in how that weight is generated:
 * `brush` from freehand strokes, `subject`/`sky` from an in-browser segmentation
 * model. The application pipeline treats them identically.
 */
export type MaskType = 'brush' | 'subject' | 'sky'

/** A point of a brush stroke, in image-pixel coordinates. */
export interface MaskPoint {
  x: number
  y: number
}

/** Whether a brush stroke paints the mask in or carves it back out. */
export type BrushMode = 'add' | 'erase'

/**
 * One freehand brush stroke: the polyline the pointer traced plus the brush
 * shape. Strokes are the *generative description* of a brush mask — the heavy
 * rasterised alpha is derived from them on demand and cached outside history,
 * so undo/redo only ever moves these light vectors around.
 */
export interface BrushStroke {
  /** Traced points in image pixels, in order. */
  points: MaskPoint[]
  /** Brush radius in image pixels. */
  radius: number
  /** Edge softness, 0 (hard) to 1 (fully feathered). */
  hardness: number
  /** Paint into or erase from the mask. */
  mode: BrushMode
}

/**
 * A single local-adjustment mask. `adjustments` holds this mask's own slider
 * values (see {@link MASK_ADJUSTMENT_KEYS}); `strokes` describes a brush mask
 * and stays empty for AI masks. `version` bumps whenever the mask's pixel data
 * changes, so the external pixel cache can be keyed by `id@version`.
 */
export interface Mask {
  id: string
  type: MaskType
  name: string
  /** This mask's local adjustment values, keyed by `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Inverts the mask weight (affect everything *outside* the selection). */
  invert: boolean
  /** Brush strokes, oldest first. Empty for `subject`/`sky` masks. */
  strokes: BrushStroke[]
  /** Pixel-data revision; bump to invalidate the cached alpha for this mask. */
  version: number
}

/** Maximum number of masks the editor keeps at once. */
export const MAX_MASKS = 5

/**
 * The adjustment keys a mask may carry: the single-pass tone and colour sliders
 * (Basic + Color). The blur-based local-contrast sliders (clarity/dehaze/
 * texture) are deliberately excluded — they stay global, applied after masks.
 */
export const MASK_ADJUSTMENT_KEYS: readonly string[] = [
  ...basicAdjustments.map((o) => o.key),
  ...colorAdjustement.map((o) => o.key),
]

/** Human-readable default name per mask type. */
export const MASK_TYPE_LABEL: Record<MaskType, string> = {
  brush: 'Brush',
  subject: 'Subject',
  sky: 'Sky',
}

/**
 * Builds the default (all-zero) adjustment map for a new mask, seeded from the
 * Basic and Color slider groups.
 */
export function buildMaskAdjustments(): Record<string, number> {
  return {
    ...buildDefaults(basicAdjustments),
    ...buildDefaults(colorAdjustement),
  }
}

/**
 * Creates a fresh mask of the given type with default adjustments and no pixel
 * data. The caller supplies the display name (the store derives a unique one).
 *
 * @param type - Which kind of mask to create.
 * @param name - Display name to show in the mask list.
 * @returns A new {@link Mask} with a unique id.
 */
export function createMask(type: MaskType, name: string): Mask {
  return {
    id: crypto.randomUUID(),
    type,
    name,
    adjustments: buildMaskAdjustments(),
    invert: false,
    strokes: [],
    version: 0,
  }
}
