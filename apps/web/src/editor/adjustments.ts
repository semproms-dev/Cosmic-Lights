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

export const detailsAdjustement: ColorOption[] = [
  /*{ key: 'sharpness', label: 'Sharpness', min: -5, max: 5, step: 0.1, defaultValue: 0, group: '' },*/
  { key: 'clarity', label: 'Clarity', min: -5, max: 5, step: 0.1, defaultValue: 0, group: '' },
  { key: 'dehaze', label: 'Dehaze', min: -5, max: 5, step: 0.1, defaultValue: 0, group: '' },
  { key: 'texture', label: 'Texture', min: -5, max: 5, step: 0.1, defaultValue: 0, group: '' },
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
]

/**
 * Builds the initial value map (`key -> defaultValue`) for a set of sliders.
 */
export function buildDefaults(options: SliderOption[]): Record<string, number> {
  return Object.fromEntries(options.map((option) => [option.key, option.defaultValue]))
}
