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
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.1, defaultValue: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, defaultValue: 0 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, defaultValue: 0 },
]

export const colorAdjustement: ColorOption[] = [
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, defaultValue: 0, group: 'White Balance' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, defaultValue: 0, group: 'White Balance' },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, defaultValue: 0, group: 'Presence' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0, group: 'Presence' },
]

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
  // Detail is the *shape* of the luminance filter, not its amount — like the
  // grain's size and roughness. Hence a neutral value of 50 rather than 0: what
  // turns the effect off is `luminanceNoise = 0`.
  { key: 'luminanceDetail', label: 'Luminance Detail', min: 0, max: 100, step: 1, defaultValue: 50, group: 'noise', type: 'slider' },
  { key: 'denoiseRemove', label: 'Auto denoise removal', step: 0, min: 0, max: 0, defaultValue: 0, group: 'noise', type: 'button' },
]

/**
 * Frame effects: they act on the displayed frame, not on the pixel. Post-crop,
 * like Lightroom's Post-Crop Vignetting — the oval recentres on the crop and
 * turns with the image. Kept out of `MASK_ADJUSTMENT_KEYS` on purpose: a mask
 * with its own vignette means nothing.
 */
export const effectsAdjustement: ColorOption[] = [
  { key: 'vignette', label: 'Vignette', min: -100, max: 100, step: 1, defaultValue: 0, group: '' },
  { key: 'vignetteMidpoint', label: 'Midpoint', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
  { key: 'vignetteFeather', label: 'Feather', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
  { key: 'grain', label: 'Grain', min: 0, max: 100, step: 1, defaultValue: 0, group: '' },
  { key: 'grainSize', label: 'Size', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
  { key: 'grainRoughness', label: 'Roughness', min: 0, max: 100, step: 1, defaultValue: 50, group: '' },
]

/**
 * Builds the initial value map (`key -> defaultValue`) for a set of sliders.
 */
export function buildDefaults(options: SliderOption[]): Record<string, number> {
  return Object.fromEntries(options.map((option) => [option.key, option.defaultValue]))
}
