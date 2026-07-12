import { CHANNELS, type Curves } from "./curves";
import type { EditorAction, editorReducer, EditorStoreState } from "./editorReducer";
import type { CropRegion } from "./image";



interface HistorySlice {
    adjustements: Record<string, number>,
    cropRatio: string,
    curves: Curves,
    cropRegion: CropRegion | null
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
    cropRegion: s.cropRegion,
    curves: s.curves
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

const sliceEquals = (a: HistorySlice, b: HistorySlice): boolean =>
  a.cropRatio === b.cropRatio &&
  regionEquals(a.cropRegion, b.cropRegion) &&
  recordEquals(a.adjustements, b.adjustements) &&
  curvesEqual(a.curves, b.curves)

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