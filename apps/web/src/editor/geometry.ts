/**
 * Lens and framing geometry: the Distortion / Perspective / Transform / Offset
 * controls of the Crop panel.
 *
 * These four families are **not** the same kind of transformation, and that is
 * the whole design of this module:
 *
 * | Control     | Maths                              | Where it lands            |
 * |-------------|------------------------------------|---------------------------|
 * | Distortion  | radial, non-linear in the radius   | its own step, on the source UV |
 * | Perspective | homography (keystone)              | a `mat3`, needs the `w` divide |
 * | Transform   | non-uniform scale                  | the same `mat3`           |
 * | Offset      | translation                        | the same `mat3`           |
 *
 * Everything except the distortion folds into one 3×3 matrix. The distortion
 * cannot: no matrix of any size expresses `r → r·(1 + k1·r²)`.
 *
 * It lives apart from `rotation.ts` because the dependency runs one way —
 * {@link uvTransform} composes this module's matrix with the crop and the
 * orientation, so this module must not need `rotation.ts` back.
 */

/**
 * The geometry sliders, each on the panel's raw −100..100 scale. Physical units
 * are derived on the way to the matrix ({@link geometryMatrix}) so the store
 * keeps exactly what the sliders show.
 *
 * `scaleX`/`scaleY` are the two *Transform* sliders: together they cover both a
 * plain zoom (move them as one) and an aspect stretch (move one).
 */
export interface Geometry {
  /** Radial lens correction. Positive corrects barrel, negative pincushion. */
  distortion: number
  /** Vertical keystone: leans the frame's top edge towards or away. */
  perspectiveV: number
  /** Horizontal keystone. */
  perspectiveH: number
  /** Horizontal scale, logarithmic: ±100 is ×2 / ÷2. */
  scaleX: number
  /** Vertical scale, logarithmic. */
  scaleY: number
  /** Pan the image within the frame; positive moves it right. */
  offsetX: number
  /** Positive moves it **down** — UV is y-down, and so is this. */
  offsetY: number
}

/** No lens correction, no keystone, no scaling, no pan: what an image opens as. */
export const IDENTITY_GEOMETRY: Geometry = {
  distortion: 0,
  perspectiveV: 0,
  perspectiveH: 0,
  scaleX: 0,
  scaleY: 0,
  offsetX: 0,
  offsetY: 0,
}

/**
 * How far each slider reaches in physical units at ±100. Chosen so the extremes
 * are strong but still well-behaved:
 *
 * - `K1` at 0.3 covers any real lens, and keeps {@link undistort}'s cubic clear
 *   of the fold that would leave a sampled point with no preimage at all.
 * - `KEYSTONE` at 0.5 keeps the homogeneous `w = 1 + g·y` inside [0.75, 1.25]
 *   for every point of the frame (`|y| ≤ 0.5`). It can never reach zero, so the
 *   divide is safe and no part of the quad ends up behind the camera — which is
 *   what a wilder range would buy in exchange for a torn image.
 * - `SCALE_OCTAVES` is applied as a power of two, so ±100 is ×2 and ÷2 and the
 *   slider is symmetric about the middle. A linear scale would not be: +50%
 *   and −50% are not opposite moves.
 * - `OFFSET` at 0.5 slides the image a whole half-frame, which is as far as it
 *   can go before the frame holds nothing but backdrop.
 */
const RANGE = {
  K1: 0.3,
  KEYSTONE: 0.5,
  SCALE_OCTAVES: 1,
  OFFSET: 0.5,
} as const

/** A `mat3` in **column-major** order, ready for `uniformMatrix3fv`. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

/** The 3×3 identity, column-major. */
export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * The radial coefficient the {@link Geometry.distortion} slider stands for.
 *
 * @param geometry - The geometry slice.
 */
export function lensK1(geometry: Geometry): number {
  return (geometry.distortion / 100) * RANGE.K1
}

/**
 * Converts an image UV offset into the aspect-corrected, corner-normalised
 * coordinates the radial term is measured in: `|q| = 1` exactly at the image's
 * corners, whatever its shape.
 *
 * Feeding the raw UV offset instead is the classic way to get this wrong. UV is
 * `[0,1]²` over a rectangle that is *not* square, so a circle in UV is an
 * ellipse on the sensor: the correction would come out oval, stronger along the
 * short axis, and straight lines would still bend after being "corrected".
 *
 * @param imageWidth - Full image width in pixels.
 * @param imageHeight - Full image height in pixels.
 * @returns The per-axis factor to multiply `uv − 0.5` by.
 */
export function lensScale(imageWidth: number, imageHeight: number): [number, number] {
  const diagonal = Math.hypot(imageWidth, imageHeight)
  // uv − 0.5 spans ±0.5, so ×2·side/diagonal puts the corner at |q| = 1.
  return [(2 * imageWidth) / diagonal, (2 * imageHeight) / diagonal]
}

/**
 * The radial step of the sampling chain: given the source UV a pixel would read
 * with a perfect lens, the UV it must read through a distorted one.
 *
 * Sampling runs backwards, so this is the *forward* map of the shader's
 * `distortLens`: `k1 > 0` pushes the samples outward, which drags the image
 * content inward at the edges and straightens lines that bulged out — barrel
 * correction. `k1 = 0` returns the input untouched, bit for bit.
 *
 * The centre is the middle of the **source image**, never the crop's or the
 * rotated frame's: distortion is a property of the lens, so tying it to the
 * crop would make the correction drift as the user moves the crop, which is
 * plainly visible on any shot with a straight edge.
 *
 * @param uv - The undistorted image UV.
 * @param k1 - The radial coefficient (see {@link lensK1}).
 * @param scale - The aspect correction from {@link lensScale}.
 * @returns The image UV to sample.
 */
export function distort(
  uv: { x: number; y: number },
  k1: number,
  scale: [number, number],
): { x: number; y: number } {
  if (k1 === 0) return uv
  const dx = uv.x - 0.5
  const dy = uv.y - 0.5
  const qx = dx * scale[0]
  const qy = dy * scale[1]
  const factor = 1 + k1 * (qx * qx + qy * qy)
  return { x: 0.5 + dx * factor, y: 0.5 + dy * factor }
}

/**
 * How many Newton steps {@link undistort} takes.
 *
 * Eight, not the three or four a well-conditioned Newton would want, because
 * the worst case is not well conditioned: at `k1 = −0.3` the cubic's turning
 * point sits at `r = 1.054`, barely outside the image's own corner at `r = 1`,
 * so the derivative there is ~0.11 and the quadratic phase starts late. Eight
 * passes take the worst point on the frame to 1e-15; four leave 4e-4, which is
 * two pixels out on a 6000px photo.
 */
const UNDISTORT_ITERATIONS = 8

/**
 * The inverse of {@link distort}, for the pointer: given the UV that *was*
 * sampled, the undistorted UV it came from.
 *
 * `r → r + k1·r³` is a cubic, so there is no closed-form inverse worth writing
 * and this solves it numerically — in the aspect-corrected `q` space, where the
 * map is purely radial and the whole problem is one scalar equation.
 *
 * **Newton, not the obvious fixed-point iteration.** `d ← target/(1 + k1·|d|²)`
 * looks simpler and is a contraction, but only barely: its rate is `2(f−1)/f`,
 * which at the slider's own limit (`k1 = 0.3`, a corner sampled out to `r ≈ 1.3`)
 * is 0.67. Eight passes of that still leave ~1.4e-2 of UV — some eighty pixels
 * on a 6000px frame, i.e. a brush stroke landing visibly away from the cursor.
 * Newton clears the same case to float precision (see {@link UNDISTORT_ITERATIONS}).
 *
 * The root is the right one by construction: Newton starts at `r'`, and for
 * `k1 > 0` the cubic is monotone everywhere, while for `k1 < 0` the start sits
 * below the turning point at `r = √(−1/3k1)` for every `r'` the forward map can
 * actually produce. A `r'` beyond that has no preimage at all — the lens folds —
 * and the iteration simply stops after its four passes rather than wandering.
 *
 * @param uv - The distorted image UV.
 * @param k1 - The radial coefficient.
 * @param scale - The aspect correction from {@link lensScale}.
 * @returns The undistorted image UV.
 */
export function undistort(
  uv: { x: number; y: number },
  k1: number,
  scale: [number, number],
): { x: number; y: number } {
  if (k1 === 0) return uv
  const dx = uv.x - 0.5
  const dy = uv.y - 0.5
  const qx = dx * scale[0]
  const qy = dy * scale[1]
  const distorted = Math.hypot(qx, qy)
  // Dead centre: no direction to walk along, and no distortion there anyway.
  if (distorted === 0) return uv

  let r = distorted
  for (let i = 0; i < UNDISTORT_ITERATIONS; i += 1) {
    const h = r + k1 * r * r * r - distorted
    const slope = 1 + 3 * k1 * r * r
    if (slope === 0) break
    r -= h / slope
  }

  // The map is radial, so the direction survives it: only the radius changed,
  // and the ratio carries straight back to UV without re-dividing by `scale`.
  const ratio = r / distorted
  return { x: 0.5 + dx * ratio, y: 0.5 + dy * ratio }
}

/**
 * The physical parameters the matrix is built from, pulled out of the sliders.
 */
function physical(geometry: Geometry) {
  return {
    // Keystone: the bottom row of the homography, i.e. how fast `w` grows.
    gx: (geometry.perspectiveH / 100) * RANGE.KEYSTONE,
    gy: (geometry.perspectiveV / 100) * RANGE.KEYSTONE,
    // Powers of two, so ±100 are exact reciprocals and 0 is exactly 1.
    sx: 2 ** ((geometry.scaleX / 100) * RANGE.SCALE_OCTAVES),
    sy: 2 ** ((geometry.scaleY / 100) * RANGE.SCALE_OCTAVES),
    ox: (geometry.offsetX / 100) * RANGE.OFFSET,
    oy: (geometry.offsetY / 100) * RANGE.OFFSET,
  }
}

/**
 * Turns −0 into 0.
 *
 * Negating a product of an untouched slider yields negative zero, which behaves
 * identically to zero everywhere the matrix is actually used — but compares
 * *unequal* under a deep strict equality, which is precisely how the identity
 * regression test asks "did an untouched panel change anything?". Normalising
 * here lets that test keep exact equality instead of an epsilon that would let
 * real drift slip through.
 *
 * @param value - The number to normalise.
 */
const zeroed = (value: number): number => (value === 0 ? 0 : value)

/**
 * The **sampling** matrix: from a point on the drawn quad (`vUv − 0.5`, so
 * `[−0.5, 0.5]²` with the frame's centre at the origin) back to the point the
 * crop/orientation remap should be given.
 *
 * It is the inverse of the chain the user thinks in. Forward — how the picture
 * is built — the frame is keystoned, then scaled, then slid:
 *
 * ```
 * G = T(offset) · S(scale) · K(keystone)
 * ```
 *
 * and the shader asks the opposite question ("which source point lands here?"),
 * so what it needs is `G⁻¹ = K⁻¹ · S⁻¹ · T⁻¹`. Each factor is inverted in closed
 * form rather than the product being inverted numerically: `K⁻¹` is just `K`
 * with its bottom row negated (its determinant is 1), so the identity comes out
 * exactly the identity — no `1/det` rounding on an image the user never touched.
 *
 * The keystone sits *innermost* on purpose. It is the only factor that is not
 * centre-preserving under the others: put it outside the offset and sliding the
 * image would change how strongly it leans, which reads as the two sliders
 * fighting each other.
 *
 * Written out, with `s = 1/scale` and `o = offset`:
 *
 * ```
 *          ⎡  1/sx        0        −ox/sx           ⎤
 * G⁻¹  =   ⎢    0       1/sy       −oy/sy           ⎥
 *          ⎣ −gx/sx    −gy/sy   1 + gx·ox/sx + gy·oy/sy ⎦
 * ```
 *
 * @param geometry - The geometry slice.
 * @returns The `mat3` in column-major order for `uniformMatrix3fv`.
 */
export function geometryMatrix(geometry: Geometry): Mat3 {
  const { gx, gy, sx, sy, ox, oy } = physical(geometry)
  const ix = 1 / sx
  const iy = 1 / sy
  // Rows of G⁻¹ = K⁻¹ · S⁻¹ · T⁻¹.
  const a00 = ix
  const a02 = zeroed(-ox * ix)
  const a11 = iy
  const a12 = zeroed(-oy * iy)
  const a20 = zeroed(-gx * ix)
  const a21 = zeroed(-gy * iy)
  const a22 = 1 + gx * ox * ix + gy * oy * iy
  // Column-major: [col0, col1, col2].
  return [a00, 0, a20, 0, a11, a21, a02, a12, a22]
}

/**
 * The **forward** matrix, `G = T(offset) · S(scale) · K(keystone)`: from the
 * pre-geometry frame point to where it ends up on the drawn quad. The exact
 * inverse of {@link geometryMatrix}, built in closed form for the same reason.
 *
 * Only the pointer needs it — an overlay handle authored in image space has to
 * be drawn where the user now sees it.
 *
 * @param geometry - The geometry slice.
 * @returns The `mat3` in column-major order.
 */
export function inverseGeometryMatrix(geometry: Geometry): Mat3 {
  const { gx, gy, sx, sy, ox, oy } = physical(geometry)
  // Rows of T · S · K.
  const a00 = sx + ox * gx
  const a01 = ox * gy
  const a02 = ox
  const a10 = oy * gx
  const a11 = sy + oy * gy
  const a12 = oy
  return [a00, a10, gx, a01, a11, gy, a02, a12, 1]
}

/**
 * Applies a column-major `mat3` to a 2D point in homogeneous coordinates and
 * divides through by `w` — the CPU twin of GLSL's `(m * vec3(p, 1.0)).xy / .z`.
 *
 * It exists so the pointer and the shader can never disagree about what the
 * perspective does: both run this same composition, one of them in TypeScript.
 *
 * @param m - The matrix, column-major.
 * @param p - The point, relative to the frame's centre.
 * @returns The transformed point, still relative to the frame's centre.
 */
export function applyMat3(m: Mat3, p: { x: number; y: number }): { x: number; y: number } {
  const x = m[0] * p.x + m[3] * p.y + m[6]
  const y = m[1] * p.x + m[4] * p.y + m[7]
  const w = m[2] * p.x + m[5] * p.y + m[8]
  return { x: x / w, y: y / w }
}

/**
 * True when the geometry is the identity — every slider at its default.
 *
 * The renderer uses it to keep the untouched case on exactly the code path it
 * had before this feature existed.
 *
 * @param geometry - The geometry slice.
 */
export function isIdentityGeometry(geometry: Geometry): boolean {
  return (
    geometry.distortion === 0 &&
    geometry.perspectiveV === 0 &&
    geometry.perspectiveH === 0 &&
    geometry.scaleX === 0 &&
    geometry.scaleY === 0 &&
    geometry.offsetX === 0 &&
    geometry.offsetY === 0
  )
}

/**
 * Value equality for the history's change detection, which must not file a
 * commit for a drag that ended where it started.
 *
 * @param a - One geometry slice.
 * @param b - The other.
 */
export function geometryEquals(a: Geometry, b: Geometry): boolean {
  return (
    a === b ||
    (a.distortion === b.distortion &&
      a.perspectiveV === b.perspectiveV &&
      a.perspectiveH === b.perspectiveH &&
      a.scaleX === b.scaleX &&
      a.scaleY === b.scaleY &&
      a.offsetX === b.offsetX &&
      a.offsetY === b.offsetY)
  )
}
