import { useHotkeys } from '@mantine/hooks'
import { useEditor } from './editorContext'
import { SHORTCUTS, type ShortcutActionId } from './shortcuts'

/**
 * The callbacks the shortcut dispatcher needs but cannot read from the editor
 * store — they live in the host component (`HomePage`).
 */
export interface EditorShortcutHandlers {
  /** Switches the active tool/panel by its rail label. */
  setActiveTool: (label: string) => void
  /** Opens the file picker (clicks the hidden RAW `<input>`). */
  openImage: () => void
  /** Opens the shortcuts reference panel. */
  showShortcuts: () => void
}

/**
 * Wires the shortcut registry to the keyboard. Builds the `useHotkeys` bindings
 * from {@link SHORTCUTS} (disabled entries are skipped), and dispatches each to a
 * handler drawn from the store or from `handlers`. Actions that operate on the
 * photo are guarded to no-op while no image is loaded. Mantine's `useHotkeys`
 * already ignores events originating in inputs/textareas/contentEditable.
 *
 * @param handlers - Host-provided callbacks (tool switch, open image, show help).
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const { resetAdjustements, resetCurves, clearCrop, image } = useEditor()

  const actions: Record<ShortcutActionId, () => void> = {
    openImage: handlers.openImage,
    resetAll: () => {
      resetAdjustements()
      resetCurves()
      clearCrop()
    },
    undo: () => {}, // no-op until an edit history exists
    redo: () => {},
    toolInfo: () => handlers.setActiveTool('Info'),
    toolAdjustments: () => handlers.setActiveTool('Adjustments'),
    toolCrop: () => handlers.setActiveTool('Crop'),
    toolExport: () => handlers.setActiveTool('Export'),
    showShortcuts: handlers.showShortcuts,
  }

  useHotkeys(
    SHORTCUTS.filter((s) => s.enabled !== false).map((s) => [
      s.combo,
      () => {
        // Without an image, only opening one or showing the help does anything.
        if (image === null && s.id !== 'openImage' && s.id !== 'showShortcuts') {
          return
        }
        actions[s.id]()
      },
    ]),
  )
}
