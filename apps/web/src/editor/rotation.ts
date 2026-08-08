import {
  applyMat3,
  distort,
  geometryMatrix,
  IDENTITY_GEOMETRY,
  inverseGeometryMatrix,
  lensK1,
  lensScale,
  undistort,
  type Geometry,
  type Mat3,
} from './geometry'
import type { CropRegion } from './image'

/**
 * A crop region in image pixels → the UV offset and scale that samples it: the
 * fraction of the image its origin sits at, and the fraction of the image it
 * spans.
 *
 * It lives here rather than in `crop.ts` because {@link uvTransform} is its only
 * consumer, and the dependency has to run this way round: `crop.ts` needs this
 * module to map a pointer through the orientation, so this module must not need
 * `crop.ts` back.
 *
 * @param region - The crop region, in image pixels.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 */
export const cropToUvTransform = (region: CropRegion, imageWidth: number, imageHeight: number) => {
  const { x, y, width, height } = region
  const offsetX = x / imageWidth
  const offsetY = y / imageHeight

  const scaleX = width / imageWidth
  const scaleY = height / imageHeight

  return { offsetX, offsetY, scaleX, scaleY }
}

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
  /**
   * Free straighten angle in degrees, clockwise on screen. Applied *after* the
   * turns and the flips — it is the last thing that happens to the displayed
   * frame — and unlike them it resamples, so it is not lossless.
   */
  angleDeg: number
}

/** Upright, unmirrored: what an image opens as. */
export const IDENTITY_ORIENTATION: Orientation = {
  quarterTurns: 0,
  flipH: false,
  flipV: false,
  angleDeg: 0
}

/** Which way a turn goes **from the user's point of view**, not the image's. */
export type TurnDirection = 'cw' | 'ccw' | 'flipH' | 'flipV'

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
  /**
   * The perspective/scale/offset sampling matrix, applied to `vUv − 0.5`
   * **before** {@link UvTransform.matrix} — a `mat3` because a keystone needs
   * the homogeneous divide. {@link IDENTITY_MAT3} when the panel is untouched,
   * and then the whole step collapses to a no-op.
   */
  geometryMatrix: Mat3
  /**
   * The radial lens term, applied **after** everything else — the step closest
   * to the source, because the lens' centre is the source image's centre and
   * nothing downstream (crop, turn, keystone) may be allowed to move it.
   */
  lens: {
    /** Radial coefficient; `0` means the step is skipped entirely. */
    k1: number
    /** Aspect correction, so the radius is round on a non-square image. */
    scale: [number, number]
  }
  /**
   * The slice the two matrices were built from, kept so the CPU inverse can
   * rebuild the forward direction without a general 3×3 inversion.
   */
  geometry: Geometry
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
 * The axis-aligned bounding box of a `width × height` rectangle rotated by
 * `angleDeg` about its centre, in the rectangle's own units.
 *
 * A rotated rectangle's corners sweep out
 * `bboxW = w·|cosθ| + h·|sinθ|` and `bboxH = w·|sinθ| + h·|cosθ|`. This is the
 * frame the letterbox must fit and the canvas an export must allocate: letterbox
 * or crop to the *unrotated* aspect and the corners get clipped.
 *
 * `width`/`height` must already be quarter-turn-swapped — the free angle applies
 * on top of the discrete turn, so the rectangle being rotated is the *displayed*
 * frame, not the source crop.
 *
 * @param width - The unrotated rectangle's width.
 * @param height - The unrotated rectangle's height.
 * @param angleDeg - The free-angle rotation in degrees, clockwise on screen.
 */
export function rotatedBoundingBox(width: number, height: number, angleDeg: number): { width: number; height: number } {
  const a = (angleDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  return {
    width: width * c + height * s,
    height: width * s + height * c,
  }
}

/**
 * Folds the crop and the orientation into the single UV remap the composite pass
 * applies: `uv = center + matrix · (vUv − 0.5)`.
 *
 * With {@link IDENTITY_ORIENTATION} this reduces *exactly* to the plain crop
 * remap it replaces (`uv = cropOffset + vUv · cropScale`), so an unrotated image
 * renders bit-for-bit as before.
 *
 * The maths, for the record. The output frame is `(bw, bh)` — the *rotated
 * bounding box* of the crop's size, **swapped on odd quarter turns**, because a
 * quarter turn changes the frame's shape and the free angle then grows it. A
 * point at output offset `s = vUv − 0.5` is therefore `q = diag(bw, bh)·s` pixels
 * from the frame's centre. Display is built from source as
 * `q = R_free(θ) · F · R(θ) · p` (turn, mirror what you see, then straighten),
 * so sampling inverts it:
 *
 * ```
 * p  = R(−θ) · F · R_free(−θ) · q            (F is its own inverse)
 * uv = center + diag(1/W, 1/H) · p
 *    → matrix = diag(1/W, 1/H) · R(−θ) · F · R_free(−θ) · diag(bw, bh)
 * ```
 *
 * Two details in that order are load-bearing, and getting either wrong is what a
 * straighten looks like when it goes wrong:
 *
 * - **Scaling by the bounding box, not by `(ow, oh)`.** `s` runs across the quad
 *   the letterbox actually draws, and that quad is the bounding box. Feed it the
 *   unrotated frame and the two axes pick up different scale factors — an
 *   anisotropic stretch along the *tilted* axes, so the photo comes out squashed
 *   and its corners stop being square (at 30° on a 3:2 frame, a 35% stretch).
 *   With `angleDeg = 0` the box *is* `(ow, oh)`, so nothing changes there.
 * - **`R_free(−θ)` to the right of `F`.** The free angle is the last thing
 *   applied to the display, so its inverse is the first thing applied when
 *   sampling. Rotations commute with rotations, but not with a mirror
 *   (`F · R(θ) = R(−θ) · F`), so hoisting it left would straighten the wrong way
 *   round with exactly one flip on.
 *
 * `R_free(−θ)` is kept as its own `cos/sin` matrix outside the tabulated `R(−θ)`
 * so a lossless 90° turn never picks up 6.1e-17 noise (see the note above
 * `INVERSE_QUARTER_TURN`).
 *
 * The bounding box is built from `(ow, oh)` — not from `(cw, ch)` — for the same
 * reason: on an odd turn the output's x-axis spans the crop's *height*. Using
 * `(cw, ch)` there makes a quarter turn sample outside the crop on one axis and
 * short of it on the other, which reads as a squashed, cropped image on every
 * non-square photo.
 *
 * The geometry panel rides on top of all of this without disturbing any of it.
 * Its matrix is applied to `vUv − 0.5` *before* the crop remap and its lens term
 * *after*, so the frame the letterbox draws — and therefore `displayedAspect`,
 * the export size and the whole letterbox collapse the export relies on — is
 * exactly the same frame as before. That is deliberate, and it is what Lightroom
 * does with *Constrain to image* off: the frame stays put, the picture moves
 * inside it, and wherever the picture no longer covers, the backdrop shows
 * through (the shader's `inFrame` guard already paints it).
 *
 * @param orientation - The turns and mirroring to apply.
 * @param crop - The active crop in image pixels, or `null` for the full frame.
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @param geometry - Distortion/perspective/transform/offset. Defaults to the
 * identity, which reduces this to the crop-and-orientation remap it was before.
 * @returns The uniforms for the composite pass, and the displayed aspect.
 */
export function uvTransform(
  orientation: Orientation,
  crop: CropRegion | null,
  imageWidth: number,
  imageHeight: number,
  geometry: Geometry = IDENTITY_GEOMETRY,
): UvTransform {
  const region: CropRegion = crop ?? { x: 0, y: 0, width: imageWidth, height: imageHeight }
  const { offsetX, offsetY, scaleX, scaleY } = cropToUvTransform(region, imageWidth, imageHeight)
  const center: [number, number] = [offsetX + scaleX / 2, offsetY + scaleY / 2]

  // An odd turn stands the frame on its end: the output is as wide as the crop
  // is tall, and vice versa.
  const turned = orientation.quarterTurns % 2 === 1
  const outWidth = turned ? region.height : region.width
  const outHeight = turned ? region.width : region.height
  const a = (orientation.angleDeg * Math.PI) / 180 // degrees → radians
  const c = Math.cos(a)
  const s = Math.sin(a)

  const [r00, r01, r10, r11] = INVERSE_QUARTER_TURN[orientation.quarterTurns]
  const flipX = orientation.flipH ? -1 : 1
  const flipY = orientation.flipV ? -1 : 1

  // turn = R_quarter(−θ) · F, kept exact: the quarter turn is tabulated, never
  // folded into the free-angle cos/sin (see the table above), so a lossless 90°
  // turn stays bit-for-bit 0 and ±1.
  const t00 = r00 * flipX
  const t01 = r01 * flipY
  const t10 = r10 * flipX
  const t11 = r11 * flipY

  // The frame the letterbox draws — and therefore the frame `vUv` runs across —
  // is the ROTATED bounding box: the free angle grows it, and letterboxing to
  // the unrotated aspect would clip the corners. Reduces exactly to
  // (outWidth, outHeight) when angleDeg = 0.
  const bbox = rotatedBoundingBox(outWidth, outHeight, orientation.angleDeg)

  // free = R_free(−θ) · diag(bbox.width, bbox.height): from a point on the drawn
  // quad to the unrotated display frame, in image pixels. R_free(−θ) is the
  // inverse of the clockwise y-down turn `[c, −s; s, c]`, i.e. `[c, s; −s, c]`.
  const f00 = c * bbox.width
  const f01 = s * bbox.height
  const f10 = -s * bbox.width
  const f11 = c * bbox.height

  // matrix = diag(1/W, 1/H) · turn · free. Right-multiplied, not left: the free
  // angle is undone first because it was applied last (see the note above).
  const m00 = (t00 * f00 + t01 * f10) / imageWidth
  const m01 = (t00 * f01 + t01 * f11) / imageWidth
  const m10 = (t10 * f00 + t11 * f10) / imageHeight
  const m11 = (t10 * f01 + t11 * f11) / imageHeight

  return {
    matrix: [m00, m10, m01, m11],
    center,
    displayedAspect: bbox.width / bbox.height,
    geometryMatrix: geometryMatrix(geometry),
    lens: { k1: lensK1(geometry), scale: lensScale(imageWidth, imageHeight) },
    geometry,
  }
}

/**
 * Applies a {@link UvTransform} on the CPU — the exact twin of the composite
 * shader's three-step sample: geometry, then crop/orientation, then the lens.
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
  // Geometry first, in frame space: keystone, scale and pan all live on the
  // quad the user sees, not on the sensor.
  const s = applyMat3(transform.geometryMatrix, { x: vUv.x - 0.5, y: vUv.y - 0.5 })
  const uv = {
    x: transform.center[0] + m00 * s.x + m01 * s.y,
    y: transform.center[1] + m10 * s.x + m11 * s.y,
  }
  // The lens last: it is the only step measured from the source image's centre.
  return distort(uv, transform.lens.k1, transform.lens.scale)
}

/**
 * The inverse of {@link applyUvTransform}: given an image UV, returns the point
 * on the output quad (`[0,1]²`, y-down from the top) that samples it.
 *
 * It exists so something authored in image space — a gradient's handles — can be
 * drawn back where the user sees it, through the very same crop and orientation
 * the forward transform bakes in. Solving `uv = center + M·(vUv − 0.5)` for `vUv`
 * needs `M⁻¹`; `M` is a quarter-turn (optionally mirrored) of a non-empty crop,
 * so it is always non-degenerate and `det ≠ 0`.
 *
 * @param transform - The transform to invert.
 * @param uv - An image UV, y-down from the image's top.
 * @returns The point on the output quad, `[0,1]²` y-down, that samples it.
 */
export function applyInverseUvTransform(
  transform: UvTransform,
  uv: { x: number; y: number },
): { x: number; y: number } {
  const [m00, m10, m01, m11] = transform.matrix
  // Undo the three steps of applyUvTransform in reverse: lens, crop, geometry.
  const undistorted = undistort(uv, transform.lens.k1, transform.lens.scale)
  const det = m00 * m11 - m01 * m10
  const dx = undistorted.x - transform.center[0]
  const dy = undistorted.y - transform.center[1]
  // s = M⁻¹ · (uv − center), with M = [[m00, m01], [m10, m11]].
  const s = {
    x: (m11 * dx - m01 * dy) / det,
    y: (-m10 * dx + m00 * dy) / det,
  }
  const p = applyMat3(inverseGeometryMatrix(transform.geometry), s)
  return { x: p.x + 0.5, y: p.y + 0.5 }
}
