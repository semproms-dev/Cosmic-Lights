import { createContext, use } from 'react'
import { z } from 'zod'
import { logger } from '../logger'

/** Which side of the editor the tool rail and its panels live on. */
export type PanelPosition = 'left' | 'right'
export type MenuPosition = 'left' | 'right'
/** Whether the top navigation bar sits at the top or the bottom of the window. */
export type NavBarPosition = 'top' | 'bottom'

/** Interface language. Synced with the i18n runtime via PreferencesProvider. */
export type Language = 'de' | 'en' | 'es' | 'fr' | 'it'

/** User-facing application preferences, persisted across sessions. */
export interface Preferences {
  /** Side of the screen for the tool rail and open panel. */
  panelPosition: PanelPosition
  /** Base font size of the application, in pixels. */
  fontSize: number
  /** Selected interface language. */
  language: Language
  helper: boolean
  menuPosition: MenuPosition
  /** Where the top navigation bar is shown: top or bottom of the window. */
  navBarPosition: NavBarPosition
}

/** Values used before the user changes anything (and the persistence fallback). */
export const DEFAULT_PREFERENCES: Preferences = {
  panelPosition: 'right',
  fontSize: 14,
  language: 'en',
  helper: false,
  menuPosition: 'left',
  navBarPosition: 'top',
}

/** Bounds for the font-size control, shared by the UI and the parser. */
export const MIN_FONT_SIZE = 15;
export const MAX_FONT_SIZE = 25;

// Each field falls back to its default independently, so one bad value (e.g. a
// font size left mid-edit before a reload) never wipes the other preferences.
const preferencesSchema = z.object({
  panelPosition: z.enum(['left', 'right']).catch(DEFAULT_PREFERENCES.panelPosition),
  fontSize: z
    .number()
    .int()
    .min(MIN_FONT_SIZE)
    .max(MAX_FONT_SIZE)
    .catch(DEFAULT_PREFERENCES.fontSize),
  language: z.enum(['de', 'en', 'es', 'fr', 'it']).catch(DEFAULT_PREFERENCES.language),
  helper: z.boolean().catch(DEFAULT_PREFERENCES.helper),
  menuPosition: z.enum(['left', 'right']).catch(DEFAULT_PREFERENCES.menuPosition),
  navBarPosition: z
    .enum(['top', 'bottom'])
    .catch(DEFAULT_PREFERENCES.navBarPosition),
})

/** localStorage key under which the serialized preferences live. */
export const STORAGE_KEY = 'cosmiclights.preferences'

/**
 * Reads the persisted preferences from localStorage. Any missing, malformed or
 * out-of-range value falls back to {@link DEFAULT_PREFERENCES}, so a corrupt or
 * partial entry can never crash the app.
 *
 * @returns the stored preferences merged over the defaults.
 */
export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return DEFAULT_PREFERENCES
    }
    const parsed = preferencesSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      logger.warn('Discarding invalid stored preferences', parsed.error)
      return DEFAULT_PREFERENCES
    }
    return parsed.data
  } catch (error) {
    logger.error('Failed to read preferences from storage', error)
    return DEFAULT_PREFERENCES
  }
}

/**
 * Persists the given preferences to localStorage. Failures (e.g. storage full
 * or disabled) are logged and swallowed so they never break the UI update.
 *
 * @param preferences the preferences to serialize and store.
 */
export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    logger.error('Failed to persist preferences to storage', error)
  }
}

/** Store shape exposed to components: current values plus per-field setters. */
export interface PreferencesStore {
  /** The live preferences. */
  preferences: Preferences
  /** Sets the tool-rail side. */
  setPanelPosition: (position: PanelPosition) => void
  /** Sets the application base font size (clamped to the allowed range). */
  setFontSize: (size: number) => void
  /** Sets the interface language. */
  setLanguage: (language: Language) => void
  /** Sets helps messages in the app */
  setHelpers: (helper: boolean) => void
  /** Sets the position of the Top Bar Menu */
  setMenuPosition: (position: MenuPosition) => void
  /** Sets whether the top navigation bar is shown at the top or bottom. */
  setNavBarPosition: (position: NavBarPosition) => void
}

export const PreferencesContext = createContext<PreferencesStore | null>(null)

/**
 * Accesses the preferences store. Must be called inside a `PreferencesProvider`.
 *
 * @throws if used outside of a `PreferencesProvider`.
 */
export function usePreferences(): PreferencesStore {
  const context = use(PreferencesContext)
  if (context === null) {
    throw new Error('usePreferences must be used within a PreferencesProvider')
  }
  return context
}
