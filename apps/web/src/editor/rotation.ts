import { cropToUvTransform } from './crop'
import type { CropRegion } from './image'

/**
 * Quarter turns applied to the image, **clockwise**, and measured against the
 * *source* — not against what the user sees, which the flips also have a say in.
 * Anything outside 0..3 is the same rotation as one of these, so it must be kept
 * normalised: {@link turn} is the only thing that should be moving it.
 */
export type QuarterTurns = 0 | 1 | 2 | 3

/**
 * How the image is oriented on screen: 90° turns plus mirroring. Discrete and
 * lossless — it only relabels axes, unlike a free-angle straighten.
 *
 * The flips are in **display space**: `flipH` always mirrors what the user
 * currently sees left↔right, whatever `quarterTurns` is. That is what makes the
 * store's job a plain `flipH = !flipH` (see the note on {@link uvTransform}).
 */
export interface Orientation {
  quarterTurns: QuarterTurns
  /** Mirror the displayed image left↔right. */
  flipH: boolean
  /** Mirror the displayed image top↔bottom. */
  flipV: boolean
}

/** Upright, unmirrored: what an image opens as. */
export const IDENTITY_ORIENTATION: Orientation = {
  quarterTurns: 0,
  flipH: false,
  flipV: false,
}

/** Which way a turn goes **from the user's point of view**, not the image's. */
export type TurnDirection = 'cw' | 'ccw'

/**
 * Turns the orientation a quarter in the direction the user *sees* — what the
 * Rotate Right / Rotate Left buttons mean, the way Lightroom means them.
 *
 * Not a plain `(q + 1) % 4`. The turn happens *inside* the mirror
 * (`display = F · R(θ) · source`), and a mirror reverses a turn passing through
 * it: `F · R(90) = R(−90) · F`. So with exactly one flip on, incrementing
 * `quarterTurns` sends the *displayed* image anticlockwise. Two flips are not a
 * mirror at all — `diag(-1,-1)` is a half turn, and turns commute with each
 * other — so they cancel and the plain increment is right again. Hence the XOR.
 *
 * The asymmetry with {@link Orientation}'s flips is real, not an oversight:
 * reflections commute with reflections but not with rotations, which is why
 * `flipH = !flipH` needs no knowledge of `quarterTurns` while this does need the
 * flips.
 *
 * @param orientation - The orientation to turn. Left untouched.
 * @param direction - Which way it should turn on screen.
 * @returns A new orientation, already normalised to 0..3.
 */
export function turn(orientation: Orientation, direction: TurnDirection): Orientation {
  const mirrored = orientation.flipH !== orientation.flipV
  // 3, never −1: JS `%` returns a negative remainder, and there is no such key
  // in INVERSE_QUARTER_TURN.
  const step = direction === 'cw' ? 1 : 3
  return {
    ...orientation,
    quarterTurns: ((orientation.quarterTurns + (mirrored ? 4 - step : step)) % 4) as QuarterTurns,
  }
}

/**
 * The composite pass's UV remap: everything needed to sample the developed
 * texture through the crop *and* the orientation, plus the aspect the letterbox
 * has to fit.
 */
export interface UvTransform {
  /**
   * A `mat2` in **column-major** order — `[m00, m10, m01, m11]` — ready to hand
   * to `uniformMatrix2fv` with `transpose = false`.
   */
  matrix: [number, number, number, number]
  /** The crop centre in image UV. The rotation happens around this point. */
  center: [number, number]
  /** Width / height of the frame *as displayed*, for the letterbox. */
  displayedAspect: number
}

/**
 * `R(−θ)` for θ = 90°·k, in row-major order `[r00, r01, r10, r11]`.
 *
 * The inverse turn, because the shader runs backwards: it asks "which source
 * texel lands on this output pixel?". Tabulated rather than derived from
 * `Math.cos`/`Math.sin` so the entries are exactly 0 and ±1 — `cos(π/2)` is
 * 6.1e-17, not 0, and that noise would smear a lossless turn.
 *
 * Coordinates are y-down (UV of an image whose row 0 is its top), where
 * `[c, −s; s, c]` turns the image **clockwise**.
 */
const INVERSE_QUARTER_TURN: Record<QuarterTurns, [number, number, number, number]> = {
  0: [1, 0, 0, 1],
  1: [0, 1, -1, 0],
  2: [-1, 0, 0, -1],
  3: [0, -1, 1, 0],
}

/**
 * Folds the crop and the orientation into the single UV remap the composite pass
 * applies: `uv = center + matrix · (vUv − 0.5)`.
 *
 * With {@link IDENTITY_ORIENTATION} this reduces *exactly* to the plain crop
 * remap it replaces (`uv = cropOffset + vUv · cropScale`), so an unrotated image
 * renders bit-for-bit as before.
 *
 * The maths, for the record. The output frame is `(ow, oh)` — the crop's size,
 * **swapped on odd quarter turns**, because a quarter turn changes the frame's
 * shape. A point at output offset `s = vUv − 0.5` is therefore `q = diag(ow, oh)·s`
 * pixels from the frame's centre. Display is built from source as
 * `q = F · R(θ) · p` (turn, then mirror what you see), so sampling inverts it:
 *
 * ```
 * p  = R(−θ) · F · q                       (F is its own inverse)
 * uv = center + diag(1/W, 1/H) · p
 *    → matrix = diag(1/W, 1/H) · R(−θ) · F · diag(ow, oh)
 * ```
 *
 * Scaling by `(ow, oh)` — not by `(cw, ch)` — is the load-bearing detail: on an
 * odd turn the output's x-axis spans the crop's *height*. Using `(cw, ch)` there
 * makes a quarter turn sample outside the crop on one axis and short of it on
 * the other, which reads as a squashed, cropped image on every non-square photo.
 *
 * @param orientation - The turns and mirroring to apply.
 * @param crop - The active crop in image pixels, or `null` for the full frame.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @returns The uniforms for the composite pass, and the displayed aspect.
 */
export function uvTransform(
  orientation: Orientation,
  crop: CropRegion | null,
  imageWidth: number,
  imageHeight: number,
): UvTransform {
  const region: CropRegion = crop ?? { x: 0, y: 0, width: imageWidth, height: imageHeight }
  const { offsetX, offsetY, scaleX, scaleY } = cropToUvTransform(region, imageWidth, imageHeight)
  const center: [number, number] = [offsetX + scaleX / 2, offsetY + scaleY / 2]

  // An odd turn stands the frame on its end: the output is as wide as the crop
  // is tall, and vice versa.
  const turned = orientation.quarterTurns % 2 === 1
  const outWidth = turned ? region.height : region.width
  const outHeight = turned ? region.width : region.height

  const [r00, r01, r10, r11] = INVERSE_QUARTER_TURN[orientation?.quarterTurns]
  const flipX = orientation?.flipH ? -1 : 1
  const flipY = orientation?.flipV ? -1 : 1

  // matrix = diag(1/W, 1/H) · R(−θ) · diag(flipX, flipY) · diag(outWidth, outHeight)
  const m00 = (r00 * flipX * outWidth) / imageWidth
  const m01 = (r01 * flipY * outHeight) / imageWidth
  const m10 = (r10 * flipX * outWidth) / imageHeight
  const m11 = (r11 * flipY * outHeight) / imageHeight

  const cropAspect = region.width / region.height

  return {
    matrix: [m00, m10, m01, m11],
    center,
    displayedAspect: turned ? 1 / cropAspect : cropAspect,
  }
}

/**
 * Applies a {@link UvTransform} on the CPU — the exact twin of the composite
 * shader's `uv = uUvCenter + uUvMatrix * (vUv - 0.5)`.
 *
 * It exists so the transform's *meaning* can be asserted in tests (which corner
 * of the source lands where on screen) without a GL context, and so any drift
 * between this file and the shader shows up as a failing test rather than as a
 * sideways photo.
 *
 * @param transform - The transform to apply.
 * @param vUv - A point on the output quad, `[0,1]²`, y-down from the top.
 * @returns The image UV to sample, y-down from the image's top.
 */
export function applyUvTransform(
  transform: UvTransform,
  vUv: { x: number; y: number },
): { x: number; y: number } {
  const [m00, m10, m01, m11] = transform.matrix
  const sx = vUv.x - 0.5
  const sy = vUv.y - 0.5
  return {
    x: transform.center[0] + m00 * sx + m01 * sy,
    y: transform.center[1] + m10 * sx + m11 * sy,
  }
}
