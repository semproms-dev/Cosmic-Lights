/**
 * Static description of one adjustment slider: its identity and range. The live
 * value the user drags lives in the editor store, keyed by `key`.
 */
export interface SliderOption {
  key: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
}

export interface ColorOption {
  key: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  group: string
}

/**
 * One colour-grading zone: the wheel that tints it, the slider that brightens
 * it, and the three adjustment keys they write.
 *
 * The wheel is a single control but **three** scalars in the store, and they are
 * flat keys like every other slider (`gradeShadowHue`, `gradeShadowSat`,
 * `gradeShadowLum`) rather than a nested `{ shadows: { hue, sat, lum } }` object. Everything that walks the
 * adjustment map — presets, undo history, the export, the preset thumbnails —
 * reads `Record<string, number>`, so flat keys join all of it for free while a
 * nested one would mean touching every one of those places.
 *
 * Hue is stored in degrees (0..360) and saturation as a percentage (0..100),
 * never as the wheel's (x, y): the polar-to-angle conversion belongs to the UI,
 * and a coordinate pair would bake the wheel's pixel radius into the data model.
 */
export interface GradingOption {
  /** Zone id. Also the translation key under `lateralNavBar.*`. */
  key: string
  label: string
  /** Adjustment key holding the tint's hue, in degrees 0..360. */
  hueKey: string
  /** Adjustment key holding the tint's strength, 0..100. */
  satKey: string
  /** Adjustment key holding the zone's brightness offset, -100..100. */
  lumKey: string
  group: string
}

export interface EffectOption {
  key: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  group: string
}

export interface DetailOption {
  key: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  group: string
  type: string
}



/** Basic tone adjustments shown in the Adjustments panel. */
export const basicAdjustments: SliderOption[] = [
  { key: 'exposure', label: 'Exposure', min: -1, max: 1, step: 0.05, defaultValue: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, defaultValue: 0 },
]

export const colorAdjustement: ColorOption[] = [
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, defaultValue: 0, group: 'whiteBalance' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, defaultValue: 0, group: 'whiteBalance' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, defaultValue: 0, group: 'presence' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0, group: 'presence' },
]

/**
 * Colour grading: one wheel per tonal zone, tinting shadows, midtones and
 * highlights apart.
 *
 * Deliberately NOT part of {@link colorAdjustement}, which masks reuse for their
 * own sliders (see `MASK_TONE_KEYS`): grading is global, and a key that reaches
 * the mask pass without a uniform behind it saves, undoes and exports while
 * painting nothing.
 *
 * Note the zone names do not collide with the Basic sliders' `shadows` and
 * `highlights` — they share the store's one flat map, and a repeated key would
 * make the wheel and the tone slider silently drag each other.
 */
export const gradingAdjustement: GradingOption[] = [
  { key: 'gradeShadow', label: 'Shadows', hueKey: 'gradeShadowHue', satKey: 'gradeShadowSat', lumKey: 'gradeShadowLum', group: 'grading' },
  { key: 'gradeMid', label: 'Midtones', hueKey: 'gradeMidHue', satKey: 'gradeMidSat', lumKey: 'gradeMidLum', group: 'grading' },
  { key: 'gradeHigh', label: 'Highlights', hueKey: 'gradeHighHue', satKey: 'gradeHighSat', lumKey: 'gradeHighLum', group: 'grading' },
]

/** Neutral hue of a grading wheel. Irrelevant while its saturation is 0, but it still has to be a finite number. */
export const GRADING_DEFAULT_HUE = 0

/** Neutral saturation of a grading wheel. This is the one that turns the zone's *tint* off. */
export const GRADING_DEFAULT_SAT = 0

/**
 * Neutral luminance of a grading zone: no brightening, no darkening.
 *
 * Its own control, not part of the wheel: the luminance works with the tint at 0,
 * which is how a zone gets darkened without being coloured.
 */
export const GRADING_DEFAULT_LUM = 0

/** Range of the zone luminance slider, symmetric around its neutral. */
export const GRADING_LUM_RANGE = 100

/**
 * Details panel. `group` splits it in two, and the split is not cosmetic: the
 * first three ADD local contrast and the noise ones REMOVE detail, so they pull
 * against each other. Seeing them apart is what stops the user from fighting one
 * with the other. `group` is a translation key under `groups.*`, not a label.
 */
export const detailsAdjustement: DetailOption[] = [
  /*{ key: 'sharpness', label: 'Sharpness', min: -5, max: 5, step: 0.1, defaultValue: 0, group: 'localContrast' },*/
  { key: 'clarity', label: 'Clarity', min: -5, max: 5, step: 0.1, defaultValue: 0, group: 'localContrast', type: 'slider' },
  { key: 'dehaze', label: 'Dehaze', min: -5, max: 5, step: 0.1, defaultValue: 0, group: 'localContrast', type: 'slider' },
  { key: 'texture', label: 'Texture', min: -5, max: 5, step: 0.1, defaultValue: 0, group: 'localContrast', type: 'slider' },
  // Noise reduction. 0..100 rather than the -5..5 of its neighbours: there is no
  // meaningful "negative" noise reduction, and the ISO-driven Auto mapping is
  // expressed in that range. Default 0, unlike Lightroom, which ships colour NR
  // at 25 — this map also feeds the presets and the export, so a non-zero default
  // would silently restyle edits saved before the slider existed.
  { key: 'colorNoise', label: 'Color Noise', min: 0, max: 100, step: 1, defaultValue: 0, group: 'noise', type: 'slider' },
  { key: 'luminanceNoise', label: 'Luminance Noise', min: 0, max: 100, step: 1, defaultValue: 0, group: 'noise', type: 'slider' },
  // Detail is the *shape* of the luminance filter, not its amount — what turns
  // the effect off is `luminanceNoise = 0`, not this.
  //
  // Neutral is 0, and that is not the obvious choice. The slider is a straight
  // mix back toward the ORIGINAL luminance, so 50 does not mean "keep half the
  // texture", it means **put half the noise back**: it caps any luminance
  // denoiser at a 50% reduction no matter how good it is, which is precisely the
  // ceiling that made the old bilateral look like it was doing nothing. Detail
  // preservation belongs inside the filter — where the non-local means pass now
  // does it, by comparing neighbourhoods rather than pixels — and this slider is
  // what is left for a photo that wants some grit back on purpose.
  { key: 'luminanceDetail', label: 'Luminance Detail', min: 0, max: 100, step: 1, defaultValue: 0, group: 'noise', type: 'slider' },
  { key: 'denoiseRemove', label: 'Auto denoise removal', step: 0, min: 0, max: 0, defaultValue: 0, group: 'noise', type: 'button' },
]

/**
 * Frame effects: they act on the displayed frame, not on the pixel. Post-crop,
 * like Lightroom's Post-Crop Vignetting — the oval recentres on the crop and
 * turns with the image. Kept out of `MASK_ADJUSTMENT_KEYS` on purpose: a mask
 * with its own vignette means nothing.
 */
export const effectsAdjustement: EffectOption[] = [
  { key: 'vignette', label: 'Vignette', min: -100, max: 100, step: 1, defaultValue: 0, group: '' },
  { key: 'vignetteMidpoint', label: 'Midpoint', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
  { key: 'vignetteFeather', label: 'Feather', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
  { key: 'grain', label: 'Grain', min: 0, max: 100, step: 1, defaultValue: 0, group: '' },
  { key: 'grainSize', label: 'Size', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
  { key: 'grainRoughness', label: 'Roughness', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
]

/**
 * One colour-mixer channel: the three sliders that edit it and the hue centre
 * its weights fall off from.
 *
 * Like {@link GradingOption}, the three sliders are **flat** keys in the store
 * (`mixRedHue`, `mixRedSat`, …) rather than a nested object, so presets, undo,
 * the export and the preset thumbnails walk them for free.
 *
 * `center` is the hue — in degrees — that "owns" this channel on the hue wheel,
 * the point where its influence is 100% and from which it falls off toward the
 * neighbouring channels (Lightroom spaces its mixer the same way: it has two
 * extra stops, orange and purple, that the 6-colour wheel does not).
 */
export interface MixerOption {
  /** Channel id. Also the translation key under `lateralNavBar.*`. */
  key: string
  label: string
  /** Adjustment key holding the channel's hue shift, -100..100. */
  hueKey: string
  /** Adjustment key holding the channel's saturation shift, -100..100. */
  satKey: string
  /** Adjustment key holding the channel's luminance shift, -100..100. */
  lumKey: string
  /** Hue centre of the channel in degrees [0, 360). */
  center: number
  group: string
}

/**
 * The colour mixer: eight wedges of the hue wheel, each with its own hue,
 * saturation and luminance shift.
 *
 * Deliberately NOT part of {@link colorAdjustement}: the mixer is global, writes
 * eight channels × three keys, and its per-channel values are consumed by the
 * shader as a packed array, not scalar uniforms — three flat keys per channel
 * would be barren without this structure giving them their wheel order.
 */
export const colorMixerAdjustment: MixerOption[] = [
  { key: 'mixRed', label: 'Reds', hueKey: 'mixRedHue', satKey: 'mixRedSat', lumKey: 'mixRedLum', center: 0, group: 'mixer' },
  { key: 'mixOrange', label: 'Oranges', hueKey: 'mixOrangeHue', satKey: 'mixOrangeSat', lumKey: 'mixOrangeLum', center: 30, group: 'mixer' },
  { key: 'mixYellow', label: 'Yellows', hueKey: 'mixYellowHue', satKey: 'mixYellowSat', lumKey: 'mixYellowLum', center: 60, group: 'mixer' },
  { key: 'mixGreen', label: 'Greens', hueKey: 'mixGreenHue', satKey: 'mixGreenSat', lumKey: 'mixGreenLum', center: 120, group: 'mixer' },
  { key: 'mixCyan', label: 'Cyans', hueKey: 'mixCyanHue', satKey: 'mixCyanSat', lumKey: 'mixCyanLum', center: 180, group: 'mixer' },
  { key: 'mixBlue', label: 'Blues', hueKey: 'mixBlueHue', satKey: 'mixBlueSat', lumKey: 'mixBlueLum', center: 240, group: 'mixer' },
  { key: 'mixPurple', label: 'Purples', hueKey: 'mixPurpleHue', satKey: 'mixPurpleSat', lumKey: 'mixPurpleLum', center: 285, group: 'mixer' },
  { key: 'mixMagenta', label: 'Magentas', hueKey: 'mixMagentaHue', satKey: 'mixMagentaSat', lumKey: 'mixMagentaLum', center: 315, group: 'mixer' },
]

/** Range of a mixer slider, symmetric around its neutral 0. */
export const MIXER_RANGE = 100

/** Neutral of every mixer slider: no hue shift, no saturation change, no luminance offset. */
export const MIXER_DEFAULT = 0

/** Builds the initial value map for the colour mixer: three keys per channel. */
export function buildMixerDefaults(): Record<string, number> {
  return Object.fromEntries(
    colorMixerAdjustment.flatMap((option) => [
      [option.hueKey, MIXER_DEFAULT],
      [option.satKey, MIXER_DEFAULT],
      [option.lumKey, MIXER_DEFAULT],
    ]),
  )
}

/**
 * Builds the initial value map (`key -> defaultValue`) for a set of sliders.
 */
export function buildDefaults(options: SliderOption[]): Record<string, number> {
  return Object.fromEntries(options.map((option) => [option.key, option.defaultValue]))
}

/**
 * Builds the initial value map for the grading zones: three keys each — the
 * wheel's hue and saturation, and the zone's luminance.
 */
export function buildGradingDefaults(): Record<string, number> {
  return Object.fromEntries(
    gradingAdjustement.flatMap((option) => [
      [option.hueKey, GRADING_DEFAULT_HUE],
      [option.satKey, GRADING_DEFAULT_SAT],
      [option.lumKey, GRADING_DEFAULT_LUM],
    ]),
  )
}
