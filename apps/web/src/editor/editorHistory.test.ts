import { describe, expect, it } from 'vitest'
import { editorReducer, buildInitialAdjustments } from './editorReducer'
import type { EditorStoreState } from './editorReducer'
import { buildDefaultCurves } from './curves'
import type { LoadedImage } from './image'
import { undoable, initHistory, canUndo, canRedo } from './editorHistory'
import { createMask } from './masks'

// ─────────────────────────────────────────────────────────────────────────────
// TDD contract for `editor/editorHistory.ts` — a snapshot history wrapper around
// editorReducer (commit-on-release model). Implement it to satisfy these tests:
//
//   interface HistoryState {
//     past: HistorySlice[]        // committed checkpoints (oldest → newest)
//     present: EditorStoreState   // live full state
//     future: HistorySlice[]      // redo stack
//     // (plus whatever internal bookkeeping you need, e.g. a `checkpoint` slice)
//   }
//   type HistoryAction = EditorAction | { type: 'UNDO' } | { type: 'REDO' } | { type: 'COMMIT' }
//
//   undoable(reducer): (state: HistoryState, action: HistoryAction) => HistoryState
//   initHistory(present: EditorStoreState): HistoryState   // empty past/future
//   canUndo(state): boolean   // past.length > 0
//   canRedo(state): boolean   // future.length > 0
//
// Model:
//   · Editing actions (SET, SET_CURVE, SET_CROP, …) update `present` LIVE and do
//     NOT touch past/future. This is the slider dragging.
//   · COMMIT checkpoints: if the undoable slice changed since the last commit,
//     push the old checkpoint onto `past` and clear `future`. No change → no-op.
//   · UNDO/REDO move a checkpoint between past/future and merge only the
//     undoable slice (adjustments, curves, cropRegion, cropRatio) back into
//     present — volatile fields (image, imageStatus, imageDirty, resetDialogOpen)
//     are left untouched.
//   · SET_IMAGE resets the history (new document → no cross-image undo).
// ─────────────────────────────────────────────────────────────────────────────

const makeState = (): EditorStoreState => ({
  adjustments: buildInitialAdjustments(),
  curves: buildDefaultCurves(),
  image: null,
  imageStatus: 'idle',
  imageDirty: false,
  cropRegion: null,
  cropRatio: 'Original',
  resetDialogOpen: false,
  masks: [],
  activeMaskId: null,
})

const wrapped = undoable(editorReducer)

// A stand-in LoadedImage — the reducer only stores it, never touches the bitmap.
const fakeImage = {
  bitmap: {},
  width: 100,
  height: 100,
  fileName: 'shot.raw',
  metadata: {},
} as unknown as LoadedImage

describe('live edits vs commit', () => {
  it('a live edit updates present but creates no undo step until committed', () => {
    let h = initHistory(makeState())

    h = wrapped(h, { type: 'SET', key: 'exposure', value: 2 })

    expect(h.present.adjustments.exposure).toBe(2)
    expect(canUndo(h)).toBe(false)
  })

  it('collapses a burst of edits into a single undo step on COMMIT', () => {
    let h = initHistory(makeState())

    h = wrapped(h, { type: 'SET', key: 'exposure', value: 1 })
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 2 })
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 3 })
    h = wrapped(h, { type: 'COMMIT' })

    expect(h.past).toHaveLength(1)
    expect(canUndo(h)).toBe(true)
  })

  it('treats a COMMIT with no change since the last checkpoint as a no-op', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 2 })
    h = wrapped(h, { type: 'COMMIT' })

    h = wrapped(h, { type: 'COMMIT' })

    expect(h.past).toHaveLength(1)
  })
})

describe('undo / redo', () => {
  it('undo restores the previous committed slice and enables redo', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 4 })
    h = wrapped(h, { type: 'COMMIT' })

    h = wrapped(h, { type: 'UNDO' })

    expect(h.present.adjustments.exposure).toBe(0) // back to the default
    expect(canRedo(h)).toBe(true)
    expect(canUndo(h)).toBe(false)
  })

  it('redo reapplies the undone change', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 4 })
    h = wrapped(h, { type: 'COMMIT' })
    h = wrapped(h, { type: 'UNDO' })

    h = wrapped(h, { type: 'REDO' })

    expect(h.present.adjustments.exposure).toBe(4)
    expect(canRedo(h)).toBe(false)
  })

  it('walks back through multiple checkpoints', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 1 })
    h = wrapped(h, { type: 'COMMIT' })
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 2 })
    h = wrapped(h, { type: 'COMMIT' })

    h = wrapped(h, { type: 'UNDO' })
    expect(h.present.adjustments.exposure).toBe(1)

    h = wrapped(h, { type: 'UNDO' })
    expect(h.present.adjustments.exposure).toBe(0)
    expect(canUndo(h)).toBe(false)
  })

  it('discards the redo future when a new edit is committed after an undo', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 4 })
    h = wrapped(h, { type: 'COMMIT' })
    h = wrapped(h, { type: 'UNDO' })
    expect(canRedo(h)).toBe(true)

    h = wrapped(h, { type: 'SET', key: 'contrast', value: 30 })
    h = wrapped(h, { type: 'COMMIT' })

    expect(canRedo(h)).toBe(false)
    expect(h.present.adjustments.contrast).toBe(30)
  })
})

describe('scope of undo', () => {
  it('restores only the undoable slice, leaving volatile fields untouched', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 5 })
    h = wrapped(h, { type: 'COMMIT' })
    // A volatile change after the checkpoint — must survive an undo.
    h = wrapped(h, { type: 'OPEN_RESET_DIALOG' })

    h = wrapped(h, { type: 'UNDO' })

    expect(h.present.adjustments.exposure).toBe(0) // slice reverted
    expect(h.present.resetDialogOpen).toBe(true) // volatile field preserved
  })

  it('includes the crop region in history', () => {
    let h = initHistory(makeState())

    h = wrapped(h, { type: 'SET_CROP', cropRegion: { x: 10, y: 20, width: 300, height: 200 } })
    h = wrapped(h, { type: 'COMMIT' })
    expect(h.present.cropRegion).not.toBeNull()

    h = wrapped(h, { type: 'UNDO' })
    expect(h.present.cropRegion).toBeNull()
  })

  it('includes the tone curves in history', () => {
    let h = initHistory(makeState())

    // Edit a curve (an extra midpoint), then commit it as a checkpoint.
    const edited = [
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ]
    h = wrapped(h, { type: 'SET_CURVE', channel: 'rgb', points: edited })
    h = wrapped(h, { type: 'COMMIT' })
    expect(h.present.curves.rgb).toHaveLength(3)

    // Undo drops the edit; the curve returns to the 2-point identity.
    h = wrapped(h, { type: 'UNDO' })
    expect(h.present.curves.rgb).toHaveLength(2)

    // Redo reapplies the edited curve.
    h = wrapped(h, { type: 'REDO' })
    expect(h.present.curves.rgb).toEqual(edited)
  })

  it('includes masks in history and restores them on undo/redo', () => {
    let h = initHistory(makeState())
    const mask = createMask('brush', 'Brush 1')

    h = wrapped(h, { type: 'ADD_MASK', mask })
    h = wrapped(h, { type: 'COMMIT' })
    expect(h.present.masks).toHaveLength(1)

    // Undo removes the mask and clears the (now dangling) selection.
    h = wrapped(h, { type: 'UNDO' })
    expect(h.present.masks).toHaveLength(0)
    expect(h.present.activeMaskId).toBeNull()

    // Redo brings the mask back.
    h = wrapped(h, { type: 'REDO' })
    expect(h.present.masks).toHaveLength(1)
    expect(h.present.masks[0].id).toBe(mask.id)
  })

  it('checkpoints a brush stroke as one undo step', () => {
    let h = initHistory(makeState())
    const mask = createMask('brush', 'Brush 1')
    h = wrapped(h, { type: 'ADD_MASK', mask })
    h = wrapped(h, { type: 'COMMIT' })

    h = wrapped(h, {
      type: 'ADD_BRUSH_STROKE',
      id: mask.id,
      stroke: { points: [{ x: 0, y: 0 }], radius: 10, hardness: 1, mode: 'add' },
    })
    h = wrapped(h, { type: 'COMMIT' })
    expect(h.present.masks[0].strokes).toHaveLength(1)
    expect(h.present.masks[0].version).toBe(1)

    // Undo drops the stroke but keeps the mask.
    h = wrapped(h, { type: 'UNDO' })
    expect(h.present.masks[0].strokes).toHaveLength(0)
    expect(h.present.masks[0].version).toBe(0)
  })

  it('COMMIT is a no-op when nothing changed after a mask edit', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'ADD_MASK', mask: createMask('sky', 'Sky 1') })
    h = wrapped(h, { type: 'COMMIT' })
    const committed = h

    // A second commit with no intervening change must not grow the past stack.
    h = wrapped(h, { type: 'COMMIT' })
    expect(h).toBe(committed)
  })
})

describe('history reset', () => {
  it('clears past and future when a new image is loaded', () => {
    let h = initHistory(makeState())
    h = wrapped(h, { type: 'SET', key: 'exposure', value: 2 })
    h = wrapped(h, { type: 'COMMIT' })
    expect(canUndo(h)).toBe(true)

    h = wrapped(h, { type: 'SET_IMAGE', image: fakeImage })

    expect(h.past).toHaveLength(0)
    expect(h.future).toHaveLength(0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })
})

describe('boundaries', () => {
  it('UNDO on empty history is a no-op', () => {
    const h = initHistory(makeState())

    const after = wrapped(h, { type: 'UNDO' })

    expect(canUndo(after)).toBe(false)
    expect(after.present.adjustments).toEqual(h.present.adjustments)
  })

  it('REDO with nothing to redo is a no-op', () => {
    const h = initHistory(makeState())

    const after = wrapped(h, { type: 'REDO' })

    expect(canRedo(after)).toBe(false)
    expect(after.present.adjustments).toEqual(h.present.adjustments)
  })
})
