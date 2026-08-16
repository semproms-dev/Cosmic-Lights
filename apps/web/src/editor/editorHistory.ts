import { CHANNELS, type Curves } from "./curves";
import type { EditorAction, editorReducer, EditorStoreState } from "./editorReducer";
import type { CropRegion } from "./image";
import type { BrushStroke, GradientLine, Mask } from "./masks";
import type { Orientation } from "./rotation";
import { geometryEquals, type Geometry } from "./geometry";
import type { CropOrientation } from "./editorReducer";



interface HistorySlice {
    adjustements: Record<string, number>,
    cropRatio: string,
    cropOrientation: CropOrientation,
    curves: Curves,
    cropRegion: CropRegion | null,
    masks: Mask[],
    orientation: Orientation,
    geometry: Geometry
}

interface HistoryState {
  past: HistorySlice[]      // checkpoints confirmados, viejo → nuevo
  present: EditorStoreState // el estado completo y vivo (lo que se pinta)
  future: HistorySlice[]    // pila de rehacer
  checkpoint: HistorySlice  // el slice tal como estaba en el último COMMIT
}

type HistoryAction =
  | EditorAction
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'COMMIT' }


const sliceOf = (s: EditorStoreState): HistorySlice => ({
    adjustements: s.adjustments,
    cropRatio: s.cropRatio,
    cropOrientation: s.cropOrientation,
    cropRegion: s.cropRegion,
    curves: s.curves,
    masks: s.masks,
    orientation: s.orientation,
    geometry: s.geometry
});

const regionEquals = (a: CropRegion | null, b: CropRegion | null): boolean =>
  a === b || // ambos null o misma ref
  (a !== null && b !== null &&
   a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

const recordEquals = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

const curvesEqual = (a: Curves, b: Curves): boolean =>
  CHANNELS.every((ch) =>
    a[ch].length === b[ch].length &&
    a[ch].every((p, i) => p.x === b[ch][i].x && p.y === b[ch][i].y),
  )

const strokesEqual = (a: BrushStroke[], b: BrushStroke[]): boolean =>
  a.length === b.length &&
  a.every((s, i) => {
    const o = b[i]
    return (
      s.radius === o.radius &&
      s.hardness === o.hardness &&
      s.mode === o.mode &&
      s.points.length === o.points.length &&
      s.points.every((p, j) => p.x === o.points[j].x && p.y === o.points[j].y)
    )
  })

const gradientEquals = (a: GradientLine | null, b: GradientLine | null): boolean =>
  a === b || // covers null === null
  (a !== null && b !== null &&
   a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2)

const maskEquals = (a: Mask, b: Mask): boolean =>
  a.id === b.id &&
  a.type === b.type &&
  a.name === b.name &&
  a.invert === b.invert &&
  a.version === b.version &&
  recordEquals(a.adjustments, b.adjustments) &&
  strokesEqual(a.strokes, b.strokes) &&
  gradientEquals(a.gradient, b.gradient)

const masksEqual = (a: Mask[], b: Mask[]): boolean =>
  a.length === b.length && a.every((m, i) => maskEquals(m, b[i]))

const orientationEquals = (a: Orientation, b: Orientation): boolean =>
  a === b || // RESET_ORIENTATION reparte la misma ref (IDENTITY_ORIENTATION)
  (a.quarterTurns === b.quarterTurns &&
   a.flipH === b.flipH && a.flipV === b.flipV && a.angleDeg === b.angleDeg)

const sliceEquals = (a: HistorySlice, b: HistorySlice): boolean =>
  a.cropRatio === b.cropRatio &&
  a.cropOrientation === b.cropOrientation &&
  regionEquals(a.cropRegion, b.cropRegion) &&
  recordEquals(a.adjustements, b.adjustements) &&
  curvesEqual(a.curves, b.curves) &&
  masksEqual(a.masks, b.masks) &&
  orientationEquals(a.orientation, b.orientation) &&
  geometryEquals(a.geometry, b.geometry)

export const initHistory = (present: EditorStoreState): HistoryState => ({
  past: [], present, future: [], checkpoint: sliceOf(present),
})
export const canUndo = (s: HistoryState) => s.past.length > 0
export const canRedo = (s: HistoryState) => s.future.length > 0

const mergeSlice = (s: EditorStoreState, slice: HistorySlice): EditorStoreState => ({
  ...s,
  adjustments: slice.adjustements,
  curves: slice.curves,
  cropRegion: slice.cropRegion,
  cropRatio: slice.cropRatio,
  cropOrientation: slice.cropOrientation,
  masks: slice.masks,
  orientation: slice.orientation,
  geometry: slice.geometry,
  // The restored mask set may not contain the currently-selected mask; drop a
  // dangling selection so the panel doesn't point at a mask that's gone.
  activeMaskId: slice.masks.some((m) => m.id === s.activeMaskId)
    ? s.activeMaskId
    : null,
})

export const undoable = (reducer: typeof editorReducer) => {
  return (state: HistoryState, action: HistoryAction): HistoryState => {
    switch(action.type) {
      case 'COMMIT': {
        const current = sliceOf(state.present)
        if (sliceEquals(current, state.checkpoint)) return state // sin cambios → no-op
        return {
          ...state,
          past: [...state.past, state.checkpoint], // apila el checkpoint viejo
          future: [],                              // toda nueva rama borra el redo
          checkpoint: current,                     // el nuevo punto confirmado
        }
      }
      
      case 'UNDO': {
        if(state.past.length === 0) return state;
        const previous = state.past[state.past.length - 1]
        return {
          ...state,
          past: state.past.slice(0, -1),
          future: [state.checkpoint, ...state.future],
          present: mergeSlice(state.present, previous), // solo el slice
          checkpoint: previous,
        }
      }

      case 'REDO': {
        if (state.future.length === 0) return state
        const next = state.future[0]
        return {
          ...state,
          past: [...state.past, state.checkpoint],
          future: state.future.slice(1),
          present: mergeSlice(state.present, next),
          checkpoint: next,
        }
      }

      case 'SET_IMAGE': {
        const present = reducer(state.present, action);
        return initHistory(present);
      }

      default: {
        return { ...state, present: reducer(state.present, action)}
      }
    }
  }
}