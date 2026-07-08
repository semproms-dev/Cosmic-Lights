import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconFolderOpen,
  IconInfoCircle,
  IconKeyboard,
  IconZoomReset,
} from '@tabler/icons-react'

/** Stable identifier of an action a keyboard shortcut can trigger. */
export type ShortcutActionId =
  | 'openImage'
  | 'resetAll'
  | 'undo'
  | 'redo'
  | 'showShortcuts'

/** Grouping used to lay out the reference panel. */
export type ShortcutCategory = 'File' | 'Edit'  | 'View'

/** Any Tabler icon component (they all share one type). */
type ShortcutIcon = typeof IconInfoCircle

/**
 * A single shortcut definition: its display metadata plus the action `id` the
 * dispatcher maps to a handler. It carries an `id`, not a closure, so the
 * reference panel can render it without touching the editor store.
 */
export interface ShortcutDef {
  id: ShortcutActionId
  /** Combo in Mantine `useHotkeys` syntax, e.g. `'mod+O'`, `'shift+mod+Z'`, `'?'`. */
  combo: string
  /** Short label for the reference panel. */
  label: string
  category: ShortcutCategory
  icon: ShortcutIcon
  /** When `false`, shown as "soon" in the reference and its handler is a no-op. */
  enabled?: boolean
}

/**
 * The single source of truth for keyboard shortcuts. The dispatcher builds its
 * bindings from this array and the reference panel renders from it, so adding an
 * entry updates both — they can never drift apart.
 */
export const SHORTCUTS: ShortcutDef[] = [
  { id: 'openImage', combo: 'mod+O', label: 'Open image', category: 'File', icon: IconFolderOpen },
  { id: 'resetAll', combo: 'mod+shift+R', label: 'Reset changes', category: 'Edit', icon: IconZoomReset },
  { id: 'undo', combo: 'mod+Z', label: 'Undo', category: 'Edit', icon: IconArrowBackUp, enabled: false },
  { id: 'redo', combo: 'mod+shift+Z', label: 'Redo', category: 'Edit', icon: IconArrowForwardUp, enabled: false },
  { id: 'showShortcuts', combo: '?', label: 'Show shortcuts', category: 'View', icon: IconKeyboard },
]

// `mod` is Cmd on macOS and Ctrl elsewhere; resolve which for display only.
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const KEY_LABEL: Record<string, string> = IS_MAC
  ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
  : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl' }

/**
 * Formats a combo string into its display keys, e.g. `'shift+mod+Z'` →
 * `['Shift', 'Ctrl', 'Z']` (or the mac symbols). Pure and platform-aware.
 *
 * @param combo - The combo in `useHotkeys` syntax.
 * @returns The ordered list of key labels to render as `<Kbd>`.
 */
export const formatCombo = (combo: string): string[] =>
  combo.split('+').map((k) => KEY_LABEL[k] ?? k.toUpperCase())
