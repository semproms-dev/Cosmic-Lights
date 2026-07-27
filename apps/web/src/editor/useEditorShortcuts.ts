import { useHotkeys } from '@mantine/hooks'
import { useEditor } from './editorContext'
import { stepBrushSize } from './masks'
import { SHORTCUTS, type ShortcutActionId } from './shortcuts'

/**
 * The callbacks the shortcut dispatcher needs but cannot read from the editor
 * store — they live in the host component (`HomePage`).
 */
export interface EditorShortcutHandlers {
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
 * @param handlers - Host-provided callbacks (open image, show help).
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers): void {
  const { openResetDialog, image, undo, redo, brush, setBrush } = useEditor()

  const actions: Record<ShortcutActionId, () => void> = {
    openImage: handlers.openImage,
    // Reset confirms first: open the shared dialog rather than resetting here,
    // since this fires from the global shortcut, not the Canvas.
    resetAll: openResetDialog,
    undo,
    redo,
    showShortcuts: handlers.showShortcuts,
    // Brush size, Photoshop-style. Harmless outside the Masks tool: they only
    // move a tool setting, which nothing else reads.
    brushSmaller: () => setBrush({ size: stepBrushSize(brush.size, -1) }),
    brushLarger: () => setBrush({ size: stepBrushSize(brush.size, 1) }),
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
