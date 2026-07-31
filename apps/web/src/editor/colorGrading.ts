/**
 * Colour grading: how a pixel's luma is split between the three tonal zones the
 * wheels tint.
 *
 * Lives in TypeScript because the GPU is the one part of the pipeline the test
 * suite cannot run — jsdom has no WebGL, and a broken weight only shows up as a
 * wrong-looking frame. The shader gets these very constants interpolated into its
 * source (see `GRADING_GLSL` in `gl/shaders.ts`), so the two cannot drift: change
 * a number here and the GPU changes with it.
 */

/**
 * Narrowest zone overlap, at Blending 0. Deliberately above 1.0: at exactly 1
 * the shadow and highlight weights add up to 1 across the whole range and the
 * midtone wheel does nothing at all.
 */
export const GRADE_BLEND_MIN = 1.2

/** Widest zone separation, at Blending 100: narrow extremes, broad midtones. */
export const GRADE_BLEND_MAX = 5.0

/**
 * How far Balance can shift the midpoint, in stops of gamma. ±1.5 is the useful
 * range; this is the number to change if the slider feels short or long — not
 * the blending exponent.
 */
export const GRADE_BALANCE_RANGE = 1.5

/**
 * How far a zone's luminance slider can move it, at full slider and on a pixel
 * the zone owns outright. Below the 0.25 the Basic highlights/shadows offsets
 * use, on purpose: at that dose a full-slider darkening crushed a near-black to
 * black, and a grading zone is meant to nudge, not to replace the tone sliders.
 */
export const GRADE_LUM_RANGE = 0.15

/** Weight of each tonal zone for one pixel. The three add up to at most 1. */
export interface ZoneWeights {
  shadow: number
  midtone: number
  highlight: number
}

/**
 * Splits a luma between shadows, midtones and highlights.
 *
 * The midtone weight comes out by subtraction rather than from a curve of its
 * own: that is what keeps the three weights summing to ≤ 1 with no normalising
 * step, and the `max(…, 0)` is what stops a low blending from turning it
 * negative — a negative weight would invert the tint instead of dropping it.
 *
 * @param luma - Pixel luma. Clamped to 0..1: after exposure it can exceed 1, and
 *   `pow` of a negative base returns NaN, which paints the whole frame black
 *   without a single GL error.
 * @param blending - 0..100. How much the zones overlap.
 * @param balance - -100..100. Shifts the midpoint towards shadows or highlights.
 *   A gamma remap rather than an offset, so nothing clips and 0 and 1 stay put.
 */
export function zoneWeights(luma: number, blending: number, balance: number): ZoneWeights {
  const l = Math.min(Math.max(luma, 0), 1)
  const t = Math.pow(l, Math.pow(2, (-balance / 100) * GRADE_BALANCE_RANGE))
  const k = GRADE_BLEND_MIN + (GRADE_BLEND_MAX - GRADE_BLEND_MIN) * (blending / 100)

  const shadow = Math.pow(1 - t, k)
  const highlight = Math.pow(t, k)

  return { shadow, midtone: Math.max(1 - shadow - highlight, 0), highlight }
}
