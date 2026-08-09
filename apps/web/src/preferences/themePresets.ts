/** The accent-colour presets offered in Settings. */
export const THEME_IDS = [
  'violet',
  'pink',
  'yellow',
  'blue',
  'teal',
  'orange',
  'green',
  'grape',
] as const

export type ThemePresetId = (typeof THEME_IDS)[number]

/** A named visual theme. `primaryColor` drives Mantine; the app's accent CSS
 *  tokens follow the matching `data-theme` attribute (see index.css). */
export interface ThemePreset {
  readonly id: ThemePresetId
  /** i18n key for the preset's display name, under the `common` namespace. */
  readonly labelKey: string
  /** Mantine colour name used as the theme's primary color. */
  readonly primaryColor: string
}

const THEMES: Record<ThemePresetId, ThemePreset> = {
  violet: { id: 'violet', labelKey: 'settings.themeViolet', primaryColor: 'violet' },
  pink: { id: 'pink', labelKey: 'settings.themePink', primaryColor: 'pink' },
  yellow: { id: 'yellow', labelKey: 'settings.themeYellow', primaryColor: 'yellow' },
  blue: { id: 'blue', labelKey: 'settings.themeBlue', primaryColor: 'blue' },
  teal: { id: 'teal', labelKey: 'settings.themeTeal', primaryColor: 'teal' },
  orange: { id: 'orange', labelKey: 'settings.themeOrange', primaryColor: 'orange' },
  green: { id: 'green', labelKey: 'settings.themeGreen', primaryColor: 'green' },
  grape: { id: 'grape', labelKey: 'settings.themeGrape', primaryColor: 'grape' },
}


/** The preset the app uses before the user changes anything. */
export const DEFAULT_THEME: ThemePresetId = 'violet'

/** All presets in display order, for pickers and tests. */
export const THEME_PRESETS: readonly ThemePreset[] = THEME_IDS.map(
  (id) => THEMES[id],
)

/**
 * Looks up a theme preset by id, falling back to the default preset so an
 * unknown or corrupt stored id can never leave the app without a theme.
 *
 * @param id the requested preset id.
 * @returns the matching preset (or the default when unknown).
 */
export function getThemePreset(id: ThemePresetId): ThemePreset {
  return THEMES[id] ?? THEMES[DEFAULT_THEME]
}
