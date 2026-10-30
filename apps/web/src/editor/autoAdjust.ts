/**
 * Maps the load-time luma histogram to the six Basic tone sliders, the way
 * Lightroom's Auto button does.
 *
 * The mapping is deliberately *replace* not *accumulate*: it recomputes all six
 * from the histogram, so the result does not depend on what the user had
 * dragged before and pressing Auto twice lands on the same picture. It writes
 * real slider values (never a hidden flag), so the user sees every move and can
 * drag each slider onward from there — the same philosophy as `autoDenoiseSliders`.
 *
 * Everything here is pure TypeScript so it is unit-testable without a GPU, and
 * every number worth tuning is a constant at the top: the shape of the look is
 * one coefficient edit, not a rewrite.
 *
 * ## The two-stage design
 *
 * The shader applies exposure first — as a multiply on encoded luma of
 * `2^(ev/2.2)` (see `EXPOSURE_GLSL`) — and only then the zone offsets and the
 * contrast curve. So the mapping works in the same two stages:
 *
 * 1. **Exposure** from the median: how far midtones sit from mid grey.
 * 2. **Everything else** from the percentiles *after that shift*, because a
 *    bright frame exposed down still has its highlights to place afterwards.
 *
 * The zone offsets (`highlights`, `shadows`, `whites`, `blacks`) are additive
 * encoded-luma deltas weighted by `luma²` / `dark²` / `luma⁴` / `dark⁴`, each
 * at most 1. The inverse gain at full weight is therefore 400 slider units per
 * encoded-luma unit (`1 / 0.25`, from the shader's `* 0.25`), and Auto uses a
 * slightly gentler 300 so it stops short of the target it is aiming at rather
 * than overshooting into the range it meant to preserve.
 */

import type { LumaHistogram } from './histogram'

/** Median luma (encoded 0..1) Auto exposes towards: mid grey. */
const EXPOSURE_TARGET = 0.5
/**
 * Fraction of the way to the target Auto actually travels. Exposing the full
 * distance would slam a dark frame into the +1 clamp every time; 80% keeps the
 * correction meaningful without always landing on the guardrail.
 */
const EXPOSURE_GAIN = 0.8
/**
 * The shader's exposure gamma. An exposure of `ev` stops multiplies encoded
 * luma by `2^(ev/γ)`, so the stops needed to reach the target are
 * `γ · log2(target/median)`.
 */
const EXPOSURE_GAMMA = 2.2

/** p99.9 luma Auto sends towards; 0.98 leaves a hair of highlight headroom. */
const WHITE_TARGET = 0.98
/** p0.1 luma Auto sends towards; 0.02 keeps a floor of shadow detail. */
const BLACK_TARGET = 0.02
/** p90 luma Auto sends towards: recovering brights, not clipping them. */
const HIGHLIGHT_TARGET = 0.8
/** p10 luma Auto sends towards: a restrained lift that keeps dark tones dark. */
const SHADOW_TARGET = 0.18
/** p10..p90 spread Auto aims for; a narrower spread calls for contrast. */
const CONTRAST_TARGET_SPREAD = 0.45
/** Contrast slider units gained per unit of spread below the target. */
const CONTRAST_GAIN = 150
/**
 * Encoded-luma delta → slider units for the four zone offsets. The shader's
 * `* 0.25` weight makes the full-weight inverse exactly 400. Auto uses 300 for
 * highlights/whites and a lower gain for shadows, whose broad mask can wash a
 * large part of the image grey when lifted too far.
 */
const ZONE_GAIN = 300
/** Shadows need a gentler gain to preserve black depth and avoid a grey cast. */
const SHADOW_GAIN = 200

/** Exposure slider bounds, from `basicAdjustments`. */
const EXPOSURE_MIN = -1
const EXPOSURE_MAX = 1
/** Exposure slider step: Auto rounds to it so the value reads as dragged. */
const EXPOSURE_STEP = 0.05
/** Zone and contrast slider bounds, from `basicAdjustments`. */
const ZONE_MIN = -100
const ZONE_MAX = 100

/** Smallest luma Auto will ever divide by (one 8-bit step), against log2(0). */
const MIN_LUMA = 1 / 255

/** The six Basic sliders Auto proposes, keyed by `SliderOption.key`. */
export interface AutoTone {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
}

/** Non-finite percentiles mean "no signal"; rest on the neutral instead. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** Clamps a value to a slider's range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Rounds to the exposure slider's step and clamps to its range. */
function clampExposure(stops: number): number {
  return Math.round(clamp(stops, EXPOSURE_MIN, EXPOSURE_MAX) / EXPOSURE_STEP) * EXPOSURE_STEP
}

/** Rounds to the zone sliders' step of 1 and clamps to their range. */
function clampZone(value: number): number {
  return Math.round(clamp(value, ZONE_MIN, ZONE_MAX))
}

/**
 * Proposes the six Basic sliders for the frame's measured tones.
 *
 * Works on the encoded luma percentiles of the *original* image, so the result
 * is independent of any edits already in the store — replacing them, exactly
 * like `applyPreset`. The exposure moves the median toward mid grey, and the
 * four zone offsets plus contrast place the remaining percentiles after that
 * shift.
 *
 * @param histogram - The frame's luma histogram, from `computeHistogram`.
 * @returns The six slider values, rounded to each slider's step.
 */
export function autoAdjustSliders(histogram: LumaHistogram): AutoTone {
  const median = finiteOr(histogram.p50, EXPOSURE_TARGET)
  const exposure = clampExposure(
    EXPOSURE_GAIN * EXPOSURE_GAMMA * Math.log2(EXPOSURE_TARGET / Math.max(median, MIN_LUMA)),
  )
  // The shift exposure will apply, as a multiplier on encoded luma. Reuse the
  // rounded value: the percentiles below then see exactly what the picture will.
  const shift = Math.pow(2, exposure / EXPOSURE_GAMMA)

  const hiTail = finiteOr(histogram.p99_9, WHITE_TARGET) * shift
  const loTail = finiteOr(histogram.p0_1, BLACK_TARGET) * shift
  const bright = finiteOr(histogram.p90, HIGHLIGHT_TARGET) * shift
  const dark = finiteOr(histogram.p10, SHADOW_TARGET) * shift

  return {
    exposure,
    contrast: clampZone((CONTRAST_TARGET_SPREAD - (bright - dark)) * CONTRAST_GAIN),
    highlights: clampZone((HIGHLIGHT_TARGET - bright) * ZONE_GAIN),
    shadows: clampZone((SHADOW_TARGET - dark) * SHADOW_GAIN),
    whites: clampZone((WHITE_TARGET - hiTail) * ZONE_GAIN),
    blacks: clampZone((BLACK_TARGET - loTail) * ZONE_GAIN),
  }
}
