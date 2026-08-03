/**
 * Content-based noise estimation for the Auto denoise button.
 *
 * The ISO mapping (`autoDenoiseSliders`) answers "how noisy should this sensor
 * have been?"; this module answers "how noisy is the image, *actually*?". It is
 * the closed-loop half of the pair — camera-independent, and it sees what the
 * camera did on the way to JPEG (or failed to do on a pushed RAW), which the
 * ISO alone cannot know.
 *
 * The estimator is deliberately cheap and pure: it runs once per image load on
 * the decoded RGBA pixels and returns two numbers (luma and chroma noise σ in
 * 0..1 units), so it can be unit-tested without a GPU, a canvas or a shader.
 *
 * ## Why local variance, and why a low percentile
 *
 * Noise is everywhere in the frame, but real detail (edges, fabric, foliage) is
 * what dominates any *global* variance statistic. A small window that happens
 * to sit on a flat area (sky, skin, out-of-focus background) sees almost
 * nothing but the noise; a window on an edge or a texture sees a lot more.
 * Taking a low percentile of the per-window variance across the image picks the
 * flattest parts of the photo, where the variance *is* the noise floor — so
 * edges and texture do not inflate the estimate, they only raise the windows
 * the percentile discards.
 *
 * The estimate is computed in the same luma/chroma-opponent space the denoise
 * shader filters in, so the two halves of the feature speak one language.
 *
 * ## Why a curve and not just a number
 *
 * A single σ describes the whole frame, and the frame does not have a single
 * noise level. The pixels arrive gamma-encoded (see `decodeImage`), and under a
 * gamma the noise of a sensor is emphatically *not* uniform in brightness:
 *
 * - In linear light the shot noise is `σ ≈ sqrt(a·Y + b)`, with `b` the read
 *   noise, which is constant.
 * - The gamma multiplies that by `dY'/dY ∝ Y^(1/γ − 1)`.
 * - In the **midtones and highlights** `a·Y` dominates, and the two effects very
 *   nearly cancel: `sqrt(Y)·Y^(−0.545) ≈ Y^(−0.045)`, i.e. flat.
 * - In the **shadows** `b` dominates, nothing cancels the gamma, and σ climbs
 *   steeply toward black.
 *
 * So {@link estimateNoise} also reports {@link NoiseEstimate.lumaShape}: how the
 * noise is distributed across brightness, normalised so it says nothing about the
 * overall amount. That split is deliberate — the amount is already calibrated
 * (`noise.ts`), and this only tells the filter *where* to spend it.
 */

/** Size (one side) of the square windows whose local variance is the signal. */
export const NOISE_WINDOW = 5

/**
 * How many brightness bands the luma noise is reported in.
 *
 * Eight is a compromise between resolving the shadow climb described above and
 * keeping enough windows per band for the percentile to mean anything. They are
 * uniform in the stored values rather than perceptually spaced, because the axis
 * being binned is already gamma-encoded.
 */
export const NOISE_LUMA_BINS = 8

/**
 * Windows a brightness band needs before its own σ is believed.
 *
 * A band that a photo barely covers — the deep shadows of a high-key shot — gets
 * a handful of windows whose percentile is noise about noise. Below this it is
 * filled from its nearest measured neighbour instead (see {@link fillCurveGaps}),
 * which is a far better guess than a number computed from six samples.
 */
export const NOISE_MIN_SAMPLES_PER_BIN = 24

/**
 * Fraction of the flattest windows that is reported as "the" noise.
 *
 * Not the minimum: a single unlucky window could sit on a genuinely flat but
 * subtly-structured patch (drywall, water ripples) and the min would read that
 * as noise. The 25th percentile is high enough to survive one or two such
 * windows, low enough that a half-smooth photo still reports its smooth half.
 */
export const NOISE_PERCENTILE = 0.25

/** Fewer usable windows than this and the image says nothing reliable. */
export const NOISE_MIN_SAMPLES = 64

/**
 * Upper bound on sampled windows per call. The windows are spread by a stride
 * chosen from this cap, so a 45 MP frame costs no more than a 1 MP one — the
 * percentile is a statistical estimate, not an exhaustive census.
 */
export const NOISE_MAX_SAMPLES = 8192

/** Half of the window, so the centre pixel is `(window - 1) / 2` from the edge. */
const WINDOW_HALF = (NOISE_WINDOW - 1) / 2

/** How many pixels one window contains. */
const WINDOW_PIXELS = NOISE_WINDOW * NOISE_WINDOW

/** Degrees of freedom for the sample variance (Bessel's correction). */
const WINDOW_DOF = WINDOW_PIXELS - 1

/**
 * Luma weights, matching `DENOISE_FRAGMENT_SHADER`. The estimate must speak the
 * shader's language, not BT.601's: a σ measured here is fed straight into the
 * shader's range terms, and a different luma definition would make the two
 * disagree about how big "the same surface" is.
 */
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

/** Robust noise reading for one frame, in 0..1 luma/colour units. */
export interface NoiseEstimate {
  /**
   * Luma noise σ: the standard deviation a flat region of the image actually
   * has, in luma units (0..1). This is what the luminance bilateral's range
   * term has to cover.
   */
  lumaSigma: number
  /**
   * Chroma noise magnitude σ, in colour-opponent units (0..1). The geometric
   * mean of the Cb and Cr noise, i.e. how far a flat region's colour wanders.
   * This is what the chroma blur exists to average out.
   */
  chromaSigma: number
  /**
   * How the luma noise is distributed across brightness: one multiplier per
   * {@link NOISE_LUMA_BINS} band, from black to white.
   *
   * **Normalised, so it carries no dose.** Each entry is the band's σ over the
   * area-weighted mean σ of the frame, which makes the weighted mean of the
   * curve exactly 1. A filter that multiplies its range by this therefore spends
   * the same total strength it would have spent flat — it just spends more of it
   * in the shadows and less in the highlights, which is where the noise actually
   * is.
   *
   * Absent when no band gathered {@link NOISE_MIN_SAMPLES_PER_BIN} windows, or
   * when the frame measures as perfectly clean: in both cases there is no shape
   * to report and consumers fall back to a flat 1.
   */
  lumaShape?: number[]
}

/**
 * Picks the brightness band a luma value belongs to.
 *
 * @param luma - Luma in 0..1; values outside are clamped to the end bands.
 * @returns A band index in `[0, NOISE_LUMA_BINS)`.
 */
export function lumaBinIndex(luma: number): number {
  if (!Number.isFinite(luma)) {
    return 0
  }
  return Math.min(NOISE_LUMA_BINS - 1, Math.max(0, Math.floor(luma * NOISE_LUMA_BINS)))
}

/**
 * Replaces unmeasured bands with the value of the nearest measured one.
 *
 * A hold, not an extrapolation. The bands that go missing are the ones at the
 * ends — the deep shadows of a bright photo, the highlights of a dark one — and
 * those are exactly where a linear extrapolation from two noisy samples runs
 * away. Holding is the conservative choice: it never invents a trend.
 *
 * @param curve - One entry per band, `null` where the band was not measured.
 * @returns The gap-free curve, or `null` when nothing at all was measured.
 */
export function fillCurveGaps(curve: (number | null)[]): number[] | null {
  const filled = curve.slice()
  let last: number | null = null
  // Forward: every gap takes the nearest measured band to its left.
  for (let index = 0; index < filled.length; index++) {
    if (filled[index] === null) {
      filled[index] = last
    } else {
      last = filled[index]
    }
  }
  last = null
  // Backward: the leading gaps, which had nothing to their left, take the right.
  for (let index = filled.length - 1; index >= 0; index--) {
    if (filled[index] === null) {
      filled[index] = last
    } else {
      last = filled[index]
    }
  }
  return filled.every((value): value is number => value !== null) ? filled : null
}

/**
 * Smooths a curve with a 3-tap [1, 2, 1] kernel, clamping at the ends.
 *
 * One weak band should bend the curve, not put a step in it: a step is a
 * brightness at which the filter's strength jumps, and that is visible in the
 * image as a contour the photo does not have.
 *
 * @param curve - The values to smooth.
 * @returns A new, smoothed array of the same length.
 */
export function smoothCurve(curve: number[]): number[] {
  return curve.map((value, index) => {
    const before = curve[Math.max(0, index - 1)]
    const after = curve[Math.min(curve.length - 1, index + 1)]
    return (before + 2 * value + after) / 4
  })
}

/**
 * Turns the per-band σ samples into the normalised {@link NoiseEstimate.lumaShape}.
 *
 * Fill the gaps, smooth, then divide by the *area-weighted* mean — weighted by
 * how many windows each band actually holds, which is what makes the
 * normalisation a redistribution rather than a global gain change. Weighting by
 * a plain average would let a band covering 1% of the frame move the dose over
 * the other 99%.
 *
 * @param binSigmas - Per-band lists of window σs, in 0..1 units.
 * @returns The normalised curve, or `undefined` when there is no shape to report.
 */
function buildLumaShape(binSigmas: number[][]): number[] | undefined {
  const measured = binSigmas.map((sigmas) => {
    if (sigmas.length < NOISE_MIN_SAMPLES_PER_BIN) {
      return null
    }
    sigmas.sort((a, b) => a - b)
    return valueAtPercentile(sigmas, NOISE_PERCENTILE)
  })
  const filled = fillCurveGaps(measured)
  if (filled === null) {
    return undefined
  }
  const smoothed = smoothCurve(filled)
  // Bands with no windows at all carry no weight, so an unmeasured corner of the
  // histogram cannot pull the normalisation around.
  let weighted = 0
  let weight = 0
  for (let index = 0; index < smoothed.length; index++) {
    weighted += smoothed[index] * binSigmas[index].length
    weight += binSigmas[index].length
  }
  const mean = weight > 0 ? weighted / weight : 0
  if (!(mean > 0)) {
    // A frame that measures as perfectly flat has no shape, only an amount of
    // zero — and dividing by it would be the only way to get a NaN in here.
    return undefined
  }
  return smoothed.map((value) => value / mean)
}

/**
 * Picks the value at the given fraction of a sorted sample.
 *
 * @param sorted - Samples in ascending order (sorted in place by the caller).
 * @param percentile - Fraction of the way through the samples, in [0, 1].
 * @returns The sample at (or closest to) that fraction.
 */
function valueAtPercentile(sorted: number[], percentile: number): number {
  return sorted[Math.floor((sorted.length - 1) * percentile)]
}

/**
 * Estimates the image's noise from its decoded RGBA pixels.
 *
 * Samples a grid of small windows (stride chosen so at most
 * {@link NOISE_MAX_SAMPLES} run), measures the sample standard deviation of
 * luma and of the chroma-opponent pair inside each, and reports the
 * {@link NOISE_PERCENTILE}th percentile of each across the image. Returns
 * `null` when there is nothing to measure: a frame smaller than one window, a
 * buffer that does not match the dimensions, or too few windows to trust a
 * percentile.
 *
 * @param rgba - Interleaved RGBA bytes, length `width * height * 4`.
 * @param width - Frame width in pixels.
 * @param height - Frame height in pixels.
 * @returns The robust noise estimate, or `null` when the frame is too small or
 *   the buffer does not match the given dimensions.
 */
export function estimateNoise(rgba: Uint8ClampedArray, width: number, height: number): NoiseEstimate | null {
  if (width < NOISE_WINDOW || height < NOISE_WINDOW || rgba.length < width * height * 4) {
    return null
  }
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / NOISE_MAX_SAMPLES)))
  const lumaSigmas: number[] = []
  const chromaSigmas: number[] = []
  // The same window σs again, split by the window's own brightness. Free to
  // gather: the loop already computes both the mean that picks the band and the
  // σ that goes into it.
  const binSigmas: number[][] = Array.from({ length: NOISE_LUMA_BINS }, () => [])
  const rowBytes = width * 4

  for (let y = WINDOW_HALF; y + WINDOW_HALF < height; y += stride) {
    for (let x = WINDOW_HALF; x + WINDOW_HALF < width; x += stride) {
      let lumaMean = 0
      let cbMean = 0
      let crMean = 0
      for (let dy = -WINDOW_HALF; dy <= WINDOW_HALF; dy++) {
        const base = (y + dy) * rowBytes + x * 4
        for (let dx = -WINDOW_HALF; dx <= WINDOW_HALF; dx++) {
          const i = base + dx * 4
          const red = rgba[i]
          const green = rgba[i + 1]
          const blue = rgba[i + 2]
          const luma = LUMA_R * red + LUMA_G * green + LUMA_B * blue
          lumaMean += luma
          cbMean += blue - luma
          crMean += red - luma
        }
      }
      lumaMean /= WINDOW_PIXELS
      cbMean /= WINDOW_PIXELS
      crMean /= WINDOW_PIXELS

      let lumaSqDev = 0
      let cbSqDev = 0
      let crSqDev = 0
      for (let dy = -WINDOW_HALF; dy <= WINDOW_HALF; dy++) {
        const base = (y + dy) * rowBytes + x * 4
        for (let dx = -WINDOW_HALF; dx <= WINDOW_HALF; dx++) {
          const i = base + dx * 4
          const red = rgba[i]
          const green = rgba[i + 1]
          const blue = rgba[i + 2]
          const luma = LUMA_R * red + LUMA_G * green + LUMA_B * blue
          lumaSqDev += (luma - lumaMean) ** 2
          cbSqDev += (blue - luma - cbMean) ** 2
          crSqDev += (red - luma - crMean) ** 2
        }
      }
      // The sample variance of a window of *noise* estimates the noise's σ²
      // (Bessel correction). A window on a real edge has a large variance and
      // sorts into the upper percentiles, which the final pick discards.
      const lumaSigma = Math.sqrt(lumaSqDev / WINDOW_DOF) / 255
      lumaSigmas.push(lumaSigma)
      binSigmas[lumaBinIndex(lumaMean / 255)].push(lumaSigma)
      // Chroma noise is two opponents sharing one magnitude: the RMS of the Cb
      // and Cr σs, i.e. what the chroma blur has to average out on average.
      chromaSigmas.push(Math.sqrt((cbSqDev + crSqDev) / (2 * WINDOW_DOF)) / 255)
    }
  }

  if (lumaSigmas.length < NOISE_MIN_SAMPLES) {
    return null
  }
  const lumaShape = buildLumaShape(binSigmas)
  lumaSigmas.sort((a, b) => a - b)
  chromaSigmas.sort((a, b) => a - b)
  const estimate: NoiseEstimate = {
    lumaSigma: valueAtPercentile(lumaSigmas, NOISE_PERCENTILE),
    chromaSigma: valueAtPercentile(chromaSigmas, NOISE_PERCENTILE),
  }
  // Left off rather than set to a null when there is no shape: absent and "flat"
  // are the same instruction to every consumer, and one shape of the object is
  // easier to compare than two.
  return lumaShape === undefined ? estimate : { ...estimate, lumaShape }
}

/**
 * Combines per-tile estimates into one, robust to a tile that lies on texture.
 *
 * The median, not the mean: a single tile of foliage or fabric reads as very
 * noisy and would drag the average up, while the median survives it. Returns
 * `null` when no estimate survives.
 *
 * The brightness curves are merged the same way, band by band. They are *not*
 * re-normalised afterwards: each tile's curve already has a weighted mean of 1,
 * so the median of several of them is one too, near enough — and the only
 * weights that could re-normalise it honestly (per-tile window counts) are gone
 * by the time the tiles meet here.
 *
 * @param estimates - Estimates, any of which may be `null` or non-finite.
 * @returns The per-channel median estimate, or `null` when nothing usable is
 *   left to combine.
 */
export function mergeNoiseEstimates(estimates: (NoiseEstimate | null)[]): NoiseEstimate | null {
  const usable = estimates.filter(
    (estimate): estimate is NoiseEstimate =>
      estimate !== null && Number.isFinite(estimate.lumaSigma) && Number.isFinite(estimate.chromaSigma),
  )
  if (usable.length === 0) {
    return null
  }
  const lumaSigmas = usable.map((estimate) => estimate.lumaSigma).sort((a, b) => a - b)
  const chromaSigmas = usable.map((estimate) => estimate.chromaSigma).sort((a, b) => a - b)
  const middle = Math.floor(usable.length / 2)
  const merged: NoiseEstimate = {
    lumaSigma: lumaSigmas[middle],
    chromaSigma: chromaSigmas[middle],
  }
  // A tile that yielded no shape (too uniform, or too small a histogram) simply
  // does not vote; only tiles that measured one do.
  const shapes = usable
    .map((estimate) => estimate.lumaShape)
    .filter((shape): shape is number[] => shape !== undefined && shape.length === NOISE_LUMA_BINS)
  if (shapes.length === 0) {
    return merged
  }
  const shapeMiddle = Math.floor(shapes.length / 2)
  const lumaShape = Array.from({ length: NOISE_LUMA_BINS }, (_unused, bin) =>
    shapes.map((shape) => shape[bin]).sort((a, b) => a - b)[shapeMiddle],
  )
  return { ...merged, lumaShape }
}
