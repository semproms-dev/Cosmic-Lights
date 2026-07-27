import {
  basicAdjustments,
  colorAdjustement,
  detailsAdjustement,
  effectsAdjustement,
  buildDefaults,
} from './adjustments'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint, Curves } from './curves'
import type { CropRegion, ImageState, ImageStatus, LoadedImage } from './image'
import { MAX_MASKS, type BrushStroke, type GradientLine, type Mask, type ObjectPrompt, type RadialShape } from './masks'
import { IDENTITY_ORIENTATION, turn, type Orientation } from './rotation'

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
  /** Máscaras de ajuste local, en orden de creación (viejo → nuevo). */
  masks: Mask[]
  /** Id de la máscara seleccionada en el panel, o `null` si ninguna. */
  activeMaskId: string | null
  orientation: Orientation,
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
  | { type: 'ADD_MASK'; mask: Mask }
  | { type: 'REMOVE_MASK'; id: string }
  | { type: 'SET_ACTIVE_MASK'; id: string | null }
  | { type: 'SET_MASK_ADJUSTMENT'; id: string; key: string; value: number }
  | { type: 'SET_MASK_INVERT'; id: string; invert: boolean }
  | { type: 'RENAME_MASK'; id: string; name: string }
  | { type: 'ADD_BRUSH_STROKE'; id: string; stroke: BrushStroke }
  | { type: 'SET_MASK_GRADIENT'; id: string; gradient: GradientLine }
  | { type: 'SET_MASK_VERSION'; id: string; version: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'COMMIT' }
  | { type: 'ROTATE_CW'}
  | { type: 'ROTATE_CCW'}
  | { type: 'FLIP_H'}
  | { type: 'FLIP_V'}
  | { type: 'RESET_ORIENTATION'}
  | { type: 'SET_MASK_RADIAL',  id: string; radial: RadialShape}
  | { type: 'SET_MASK_PROMPT'; id: string; prompt: ObjectPrompt }

/**
 * Construye el mapa inicial de sliders a partir de los cuatro grupos (Basic,
 * Color, Details, Effects). Centralizarlo aquí evita el bug de sembrar solo
 * `basic`: una clave que falte llega al shader como `NaN` y tiñe de negro el
 * fotograma entero sin dar ningún error.
 */
export function buildInitialAdjustments(): Record<string, number> {
  return {
    ...buildDefaults(basicAdjustments),
    ...buildDefaults(colorAdjustement),
    ...buildDefaults(detailsAdjustement),
    ...buildDefaults(effectsAdjustement),
  }
}

/**
 * Aplica `update` a la máscara con `id` y devuelve un array nuevo; el resto de
 * máscaras conservan su referencia. Si no existe, devuelve el mismo array.
 */
function updateMask(
  masks: Mask[],
  id: string,
  update: (mask: Mask) => Mask,
): Mask[] {
  return masks.map((mask) => (mask.id === id ? update(mask) : mask))
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
    // Both turns go through `turn`, which is the only thing that knows a mirror
    // reverses the direction the user sees. Never touch `quarterTurns` directly.
    case 'ROTATE_CW':
      return {
        ...state,
        orientation: turn(state.orientation, 'cw'),
        imageDirty: true
      }
    case 'ROTATE_CCW':
      return {
        ...state,
        orientation: turn(state.orientation, 'ccw'),
        imageDirty: true
      }
    case 'FLIP_H':
      return {
        ...state,
        orientation: { ...state.orientation, flipH: !state.orientation.flipH },
        imageDirty: true
      }
    case 'FLIP_V':
      return {
        ...state,
        orientation: { ...state.orientation, flipV: !state.orientation.flipV },
        imageDirty: true
      }
    case 'SET_MASK_RADIAL':
      // Changes the pixels → bump version, like SET_MASK_GRADIENT.
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          radial: action.radial,
          version: mask.version + 1,
        })),
        imageDirty: true,
      }
    case 'SET_MASK_PROMPT':
      // Re-prompting re-segments the object → bump version so the renderer asks
      // the worker for a fresh alpha (the async AI path, like subject/sky).
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          prompt: action.prompt,
          version: mask.version + 1,
        })),
        imageDirty: true,
      }
    case 'RESET_ORIENTATION':
      return {
        ...state,
        orientation: IDENTITY_ORIENTATION,
        imageDirty: false
      }
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
      return { ...state, image: action.image, imageStatus: 'idle', imageDirty: false,
           cropRegion: null, cropRatio: 'Original',
           adjustments: buildInitialAdjustments(), curves: buildDefaultCurves(),
           masks: [], activeMaskId: null, orientation: IDENTITY_ORIENTATION }
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
    case 'ADD_MASK':
      // Silently ignore once the cap is reached (the UI disables the control).
      if (state.masks.length >= MAX_MASKS) return state
      return {
        ...state,
        masks: [...state.masks, action.mask],
        activeMaskId: action.mask.id,
        imageDirty: true,
      }
    case 'REMOVE_MASK': {
      const masks = state.masks.filter((mask) => mask.id !== action.id)
      if (masks.length === state.masks.length) return state
      return {
        ...state,
        masks,
        // Clear the selection if the removed mask was the active one.
        activeMaskId: state.activeMaskId === action.id ? null : state.activeMaskId,
        imageDirty: true,
      }
    }
    case 'SET_ACTIVE_MASK':
      return { ...state, activeMaskId: action.id }
    case 'SET_MASK_ADJUSTMENT':
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          adjustments: { ...mask.adjustments, [action.key]: action.value },
        })),
        imageDirty: true,
      }
    case 'SET_MASK_INVERT':
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          invert: action.invert,
        })),
        imageDirty: true,
      }
    case 'RENAME_MASK':
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          name: action.name,
        })),
      }
    case 'ADD_BRUSH_STROKE':
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          strokes: [...mask.strokes, action.stroke],
          // Bump the pixel-data revision so the cached alpha is rebuilt.
          version: mask.version + 1,
        })),
        imageDirty: true,
      }
    case 'SET_MASK_GRADIENT':
      // Changes the pixels → bump version, like ADD_BRUSH_STROKE. (Not
      // SET_MASK_VERSION, which *fixes* a version for the async AI path.)
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          gradient: action.gradient,
          version: mask.version + 1,
        })),
        imageDirty: true,
      }
    case 'SET_MASK_VERSION':
      // Announces that a generated alpha is ready in the alpha cache under this
      // exact version. The caller picks the number so the cache entry and the
      // mask cannot disagree; the renderer only uploads when the two match.
      return {
        ...state,
        masks: updateMask(state.masks, action.id, (mask) => ({
          ...mask,
          version: action.version,
        })),
        imageDirty: true,
      }
    default:
      return state
  }
}
