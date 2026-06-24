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
  { key: 'whiteBalance', label: 'White Balance', min: -5, max: 5, step: 0.1, defaultValue: 0 },
  { key: 'presence', label: 'Presence', min: -100, max: 100, step: 1, defaultValue: 0 },
]

export const detailsAdjustement: ColorOption[] = [
  { key: 'sharpness', label: 'Sharpness', min: -5, max: 5, step: 0.1, defaultValue: 0 },
  { key: 'threshold', label: 'Threshold', min: -100, max: 100, step: 1, defaultValue: 0 },
]

/**
 * Builds the initial value map (`key -> defaultValue`) for a set of sliders.
 */
export function buildDefaults(options: SliderOption[]): Record<string, number> {
  return Object.fromEntries(options.map((option) => [option.key, option.defaultValue]))
}
