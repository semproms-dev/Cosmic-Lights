import {
  basicAdjustments,
  colorAdjustement,
  detailsAdjustement,
  buildDefaults,
} from './adjustments'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint, Curves } from './curves'
import type { CropRegion, ImageState, ImageStatus, LoadedImage } from './image'

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
  /** ¿Ha sido la imagen modificada? */
  imageDirty: boolean
  /** Region recortada por el usuario  */
  cropRegion: CropRegion | null
  /** Aspect ratio seleccionado en el panel: 'Original' | '1:1' | ... | 'Free'. */
  cropRatio: string
  /**
   * ¿Está abierto el diálogo de confirmación de reset? Vive en el store porque
   * se dispara desde varios sitios (menú del Canvas y atajo global), no solo
   * desde el Canvas.
   */
  resetDialogOpen: boolean
}

export type EditorAction =
  | { type: 'SET'; key: string; value: number }
  | { type: 'SET_CURVE'; channel: ChannelId; points: CurvePoint[] }
  | { type: 'RESET_CURVES' }
  | { type: 'SET_IMAGE'; image: LoadedImage }
  | { type: 'SET_IMAGE_STATUS'; status: ImageStatus }
  | { type: 'CLEAR_IMAGE' }
  | { type: 'RESET_ADJUSTEMENTS'}
  | { type: 'SET_CROP', cropRegion: CropRegion | null}
  | { type: 'CLEAR_CROP'}
  | { type: 'SET_CROP_RATIO'; ratio: string }
  | { type: 'OPEN_RESET_DIALOG' }
  | { type: 'CLOSE_RESET_DIALOG' }

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
        imageDirty: true,
      }
    case 'SET_CURVE':
      return {
        ...state,
        curves: { ...state.curves, [action.channel]: action.points },
        imageDirty: true,
      }
    case 'RESET_CURVES':
      return { ...state, curves: buildDefaultCurves(), imageDirty: false }
    case 'SET_IMAGE':
      return { ...state, image: action.image, imageStatus: 'idle', imageDirty: false, cropRegion: null, cropRatio: 'Original' }
    case 'SET_IMAGE_STATUS':
      return { ...state, imageStatus: action.status }
    case 'CLEAR_IMAGE':
      return { ...state, image: null }
    case 'RESET_ADJUSTEMENTS':
      return { ...state, adjustments: buildInitialAdjustments(), imageDirty: false }
    case 'SET_CROP':
      return { ...state, cropRegion: action.cropRegion, imageDirty: true}
    case 'CLEAR_CROP':
      return { ...state, cropRegion: null, imageDirty: false }
    case 'SET_CROP_RATIO':
      // Choosing a ratio with no active crop isn't a destructive change; the
      // dirty flag is owned by SET_CROP.
      return { ...state, cropRatio: action.ratio }
    case 'OPEN_RESET_DIALOG':
      return { ...state, resetDialogOpen: true }
    case 'CLOSE_RESET_DIALOG':
      return { ...state, resetDialogOpen: false }
    default:
      return state
  }
}
