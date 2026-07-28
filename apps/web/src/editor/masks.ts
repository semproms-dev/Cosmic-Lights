import { basicAdjustments, buildDefaults, colorAdjustement } from './adjustments'
import type { MaskGranularity } from './segmentation/types'

export type { MaskGranularity }

/** The granularity choices offered, coarsest first — the order the UI shows. */
export const MASK_GRANULARITIES: readonly MaskGranularity[] = ['auto', 'whole', 'part', 'detail']

/**
 * How a mask's alpha map is produced. All resolve to the same thing — a
 * single-channel weight per pixel — but differ in how that weight is generated:
 * `brush` from freehand strokes, `subject`/`sky` from an in-browser segmentation
 * model, `linear` from a rasterised gradient ramp. The application pipeline
 * treats them identically.
 */
export type MaskType = 'brush' | 'subject' | 'sky' | 'linear' | 'radial' | 'object'

/**
 * The user's prompt for a promptable object mask (SAM), in **normalised [0,1]
 * image coordinates**. Refined iteratively: each extra click is another point.
 */
export interface ObjectPrompt {
  /**
   * Foreground/background points. `label` 1 = the object *contains* this pixel
   * (a click); 0 = it *does not* (a shift-click, to carve the selection back).
   */
  points: { x: number; y: number; label: 0 | 1 }[]
  /** An optional bounding box, corners in [0,1] as `(x0,y0)`–`(x1,y1)`. */
  box: { x0: number; y0: number; x1: number; y1: number } | null
  /**
   * Which reading of the click to keep — the eye, the face or the person. Absent
   * means `'auto'`: let the model's confidence decide.
   */
  granularity?: MaskGranularity
}

/** How {@link duplicateMask} should differ from the mask it copies. */
export interface DuplicateMaskOptions {
  /** Overrides the copy's invert flag; defaults to the original's. */
  invert?: boolean
  /**
   * Gives the copy the default adjustment values instead of the original's, so
   * only the selection is carried over.
   *
   * Meant for the duplicate-and-invert gesture: a mask and its inverted copy
   * cover the whole frame between them, so if the copy also inherits the tone
   * changes, every pixel gets them from one mask or the other and the local
   * adjustment silently becomes a global one.
   */
  resetAdjustments?: boolean
}

/**
 * Copies a mask under a fresh id, with the differences in {@link options}.
 *
 * Every mutable field is cloned rather than shared: the copy and the original
 * are independent edits from this point on, and a stroke array carried over by
 * reference would make painting on one of them repaint the other.
 *
 * The **alpha map is not copied** — it lives outside the mask, keyed by id, in
 * the provider's cache. Masks that rasterise from their own geometry (`brush`,
 * `linear`, `radial`) rebuild it from the fields cloned here, but an AI mask
 * (`subject`, `sky`, `object`) renders empty until the caller either copies the
 * cached alpha across or re-runs its segmentation.
 *
 * @param mask - The mask to copy.
 * @param name - Display name for the copy; callers pass a distinguishable one.
 * @param options - Which parts to change on the way. Defaults to a plain copy.
 * @returns The new mask. Not appended to the store — that is the caller's job.
 */
export const duplicateMask = (mask: Mask, name: string, options: DuplicateMaskOptions = {}): Mask => ({
  ...mask,
  id: crypto.randomUUID(),
  name,
  invert: options.invert ?? mask.invert,
  adjustments: options.resetAdjustments === true
    ? buildMaskAdjustments()
    : { ...mask.adjustments },
  strokes: mask.strokes.map(s => ({ ...s, points: [...s.points] })),
  gradient: mask.gradient === null ? null : { ...mask.gradient },
  radial:   mask.radial   === null ? null : { ...mask.radial },
  prompt:   mask.prompt   === null ? null : {
              ...mask.prompt,
              points: [...mask.prompt.points],
              box: mask.prompt.box === null ? null : { ...mask.prompt.box },
            },
})

/** One foreground/background point of an {@link ObjectPrompt}. */
export type PromptPoint = ObjectPrompt['points'][number]

/** An {@link ObjectPrompt} bounding box. */
export type PromptBox = NonNullable<ObjectPrompt['box']>

/**
 * A point in **normalised [0,1] image coordinates**, as the segmentation prompt
 * speaks them — deliberately a different type from {@link MaskPoint} (image
 * pixels), because the two are trivially confused and nothing else would catch it.
 */
export interface NormalizedPoint {
  x: number
  y: number
}

/** The empty prompt a fresh object mask starts from. */
export const EMPTY_OBJECT_PROMPT: ObjectPrompt = { points: [], box: null }

/**
 * Whether a prompt says nothing at all. The model needs at least one point or a
 * box; an empty prompt is never worth sending.
 */
export function isPromptEmpty(prompt: ObjectPrompt): boolean {
  return prompt.points.length === 0 && prompt.box === null
}

/**
 * Returns `prompt` with one more point. The prompt is always replaced whole
 * (never mutated) — the store diffs nothing and simply re-segments.
 *
 * @param prompt - The prompt so far.
 * @param point - Where the user clicked, normalised to [0,1].
 * @param label - 1 = the object contains this pixel, 0 = it does not.
 * @returns A new prompt with the point appended.
 */
export function withPromptPoint(
  prompt: ObjectPrompt,
  point: NormalizedPoint,
  label: 0 | 1,
): ObjectPrompt {
  return { ...prompt, points: [...prompt.points, { x: point.x, y: point.y, label }] }
}

/**
 * Returns `prompt` without the point at `index`.
 *
 * Removing the *last* thing a prompt says is refused: the already-segmented alpha
 * stays on screen once uploaded, so an empty prompt would leave the mask showing
 * a selection the user can no longer explain or change. Deleting the final point
 * is only allowed when a box still carries the prompt.
 *
 * @param prompt - The prompt to trim.
 * @param index - Which point to drop; out-of-range indices are ignored.
 * @returns A new prompt, or `prompt` itself when the removal is refused.
 */
export function withoutPromptPoint(prompt: ObjectPrompt, index: number): ObjectPrompt {
  if (index < 0 || index >= prompt.points.length) return prompt
  const points = prompt.points.filter((_, i) => i !== index)
  if (points.length === 0 && prompt.box === null) return prompt
  return { ...prompt, points }
}

/**
 * Returns `prompt` asking for a different reading of the same click.
 *
 * Only the granularity changes: the points and box the user placed are what
 * SAM re-decodes against, and that decode is cheap because the image embedding
 * is already cached.
 *
 * @param prompt - The prompt to re-read.
 * @param granularity - Which rung of the size ladder to keep.
 * @returns A new prompt, or `prompt` itself when nothing would change.
 */
export function withPromptGranularity(
  prompt: ObjectPrompt,
  granularity: MaskGranularity,
): ObjectPrompt {
  if (promptGranularity(prompt) === granularity) return prompt
  return { ...prompt, granularity }
}

/** The granularity a prompt asks for, defaulting to `'auto'` when unset. */
export function promptGranularity(prompt: ObjectPrompt | null): MaskGranularity {
  return prompt?.granularity ?? 'auto'
}

/**
 * Builds a prompt box from the two corners of a drag, in normalised coordinates.
 * The corners are ordered (`x0 <= x1`, `y0 <= y1`) and clamped to [0,1], so a
 * drag that runs off the image still encloses everything visible along that edge
 * — unlike a stray point, a box that overshoots is exactly what the user meant.
 *
 * @param a - Where the drag started, normalised.
 * @param b - Where it ended, normalised.
 * @returns The ordered, clamped box.
 */
export function promptBoxFromCorners(a: NormalizedPoint, b: NormalizedPoint): PromptBox {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return {
    x0: clamp(Math.min(a.x, b.x)),
    y0: clamp(Math.min(a.y, b.y)),
    x1: clamp(Math.max(a.x, b.x)),
    y1: clamp(Math.max(a.y, b.y)),
  }
}



/** A point of a brush stroke, in image-pixel coordinates. */
export interface MaskPoint {
  x: number
  y: number
}

/**
 * A linear gradient, in image pixels. The weight is 1 on the line through
 * (x1,y1) perpendicular to the segment, 0 on the line through (x2,y2), and
 * decreases linearly between them. Lightroom's three-line model.
 */
export interface GradientLine {
  x1: number
  y1: number
  x2: number
  y2: number
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
 * The live brush-tool settings the next stroke will be born with.
 *
 * Deliberately *not* document state: every {@link BrushStroke} already stores
 * its own radius/hardness/mode, so a mask redraws identically no matter what the
 * tool is set to now. Keeping these out of the store is what stops undo from
 * resizing the brush under the user's hand.
 */
export interface BrushSettings {
  /**
   * Radius as a fraction of the image's **short side**, not in pixels: the same
   * setting then covers the same portion of a 24 MP and a 60 MP frame.
   */
  size: number
  /** Edge softness, 0 (hard) to 1 (fully feathered). */
  hardness: number
  /** Whether the next stroke paints into or carves out of the mask. */
  mode: BrushMode
}

/** Bounds of {@link BrushSettings.size}: a fine 0.5% detail brush up to half the frame. */
export const BRUSH_SIZE_MIN = 0.005
export const BRUSH_SIZE_MAX = 0.5

/** What a fresh session (and every new image) starts with. */
export const DEFAULT_BRUSH: BrushSettings = { size: 0.04, hardness: 0.5, mode: 'add' }

/** Factor applied per `[` / `]` press. */
const BRUSH_SIZE_STEP = 1.25

/**
 * Resizes the brush by `steps` notches, clamped to the legal range.
 *
 * Multiplicative, not additive: a fixed increment is a huge jump on a fine brush
 * and imperceptible on a coarse one, so the same key would feel like two
 * different controls at the two ends of the range.
 *
 * @param size - Current size, as a fraction of the short side.
 * @param steps - Notches to grow (positive) or shrink (negative).
 * @returns The new size, within [{@link BRUSH_SIZE_MIN}, {@link BRUSH_SIZE_MAX}].
 */
export function stepBrushSize(size: number, steps: number): number {
  const scaled = size * Math.pow(BRUSH_SIZE_STEP, steps)
  return Math.min(BRUSH_SIZE_MAX, Math.max(BRUSH_SIZE_MIN, scaled))
}

/**
 * Converts a brush size to the radius in image pixels that strokes are stored in.
 *
 * @param size - Size as a fraction of the short side.
 * @param imageWidth - Image width in pixels.
 * @param imageHeight - Image height in pixels.
 */
export function brushRadiusPx(size: number, imageWidth: number, imageHeight: number): number {
  return size * Math.min(imageWidth, imageHeight)
}

/**
 * A single local-adjustment mask. `adjustments` holds this mask's own slider
 * values (see {@link MASK_ADJUSTMENT_KEYS}); `strokes` describes a brush mask and
 * `gradient` a linear one — each stays at its empty value for the other types.
 * `version` bumps whenever the mask's pixel data changes, so the external pixel
 * cache can be keyed by `id@version`.
 */
export interface Mask {
  id: string
  type: MaskType
  name: string
  /** This mask's local adjustment values, keyed by `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Inverts the mask weight (affect everything *outside* the selection). */
  invert: boolean
  /** Brush strokes, oldest first. Empty for non-brush masks. */
  strokes: BrushStroke[]
  /** Gradient ramp for a `linear` mask; `null` for every other type, and for a
   * `linear` mask until the first drag defines it. */
  gradient: GradientLine | null
  /** Pixel-data revision; bump to invalidate the cached alpha for this mask. */
  version: number
  /** Gradient ramp for `Radial shape` */
  radial: RadialShape | null;
  /**Prompt for selecting objects */
  prompt: ObjectPrompt | null;
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

export interface RadialShape {
  cx: number; //x for the center point
  cy: number; //y for the center point
  rx: number; //horizontal radios
  ry: number; //vertical radius
  rotation: number; //rotation degrees
  feather: number; // difumination of the center-border
}

/** Human-readable default name per mask type. */
export const MASK_TYPE_LABEL: Record<MaskType, string> = {
  brush: 'Brush',
  subject: 'Subject',
  sky: 'Sky',
  linear: 'Linear Gradient',
  radial: 'Radial Gradient',
  object: 'Select object'
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
    gradient: null,
    version: 0,
    radial: null,
    prompt: null
  }
}
