import {
  basicAdjustments,
  colorAdjustement,
  detailsAdjustement,
  buildDefaults,
} from './adjustments'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint, Curves } from './curves'
import type { ImageState, ImageStatus, LoadedImage } from './image'

/**
 * Estado completo del editor: los valores de los sliders y las curvas de tono,
 * como slices independientes dentro de un único store.
 */
export interface EditorStoreState {
  /** Valores de los sliders, indexados por `SliderOption.key`. */
  adjustments: Record<string, number>
  /** Puntos de control de la curva de tonos, por canal. */
  curves: Curves
  /** Imagen RAW decodificada y lista para pintar, o `null` si no hay ninguna. */
  image: ImageState
  /** Estado de la carga/decodificación de la imagen. */
  imageStatus: ImageStatus
}

export type EditorAction =
  | { type: 'SET'; key: string; value: number }
  | { type: 'SET_CURVE'; channel: ChannelId; points: CurvePoint[] }
  | { type: 'RESET_CURVES' }
  | { type: 'SET_IMAGE'; image: LoadedImage }
  | { type: 'SET_IMAGE_STATUS'; status: ImageStatus }
  | { type: 'CLEAR_IMAGE' }
  | { type: 'RESET_ADJUSTEMENTS'}

/**
 * Construye el mapa inicial de sliders a partir de los tres grupos (Basic,
 * Color, Details). Centralizarlo aquí evita el bug de sembrar solo `basic`.
 */
export function buildInitialAdjustments(): Record<string, number> {
  return {
    ...buildDefaults(basicAdjustments),
    ...buildDefaults(colorAdjustement),
    ...buildDefaults(detailsAdjustement),
  }
}

/**
 * Reductor del store del editor. Cada acción devuelve un estado nuevo sin mutar
 * el anterior; los slices que no cambian conservan su referencia.
 */
export function editorReducer(
  state: EditorStoreState,
  action: EditorAction,
): EditorStoreState {
  switch (action.type) {
    case 'SET':
      return {
        ...state,
        adjustments: { ...state.adjustments, [action.key]: action.value },
      }
    case 'SET_CURVE':
      return {
        ...state,
        curves: { ...state.curves, [action.channel]: action.points },
      }
    case 'RESET_CURVES':
      return { ...state, curves: buildDefaultCurves() }
    case 'SET_IMAGE':
      return { ...state, image: action.image, imageStatus: 'idle' }
    case 'SET_IMAGE_STATUS':
      return { ...state, imageStatus: action.status }
    case 'CLEAR_IMAGE':
      return { ...state, image: null }
    case 'RESET_ADJUSTEMENTS':
      return { ...state, adjustments: buildInitialAdjustments() }
    default:
      return state
  }
}
