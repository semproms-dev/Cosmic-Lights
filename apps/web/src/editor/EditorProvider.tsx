import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint } from './curves'
import { rgbToRgba, type CropRegion } from './image'
import { IDENTITY_VIEW, type CanvasView } from './crop'
import { decodeRaw } from './decodeRaw'
import { EditorContext, type RotationSpin } from './editorContext'
import { editorReducer, buildInitialAdjustments } from './editorReducer'
import { logger } from '../logger'
import { canRedo, canUndo, initHistory, undoable } from './editorHistory'
import { createMask, MASK_TYPE_LABEL, MAX_MASKS, type BrushStroke, type GradientLine, type MaskType } from './masks'
import {
  TransformersSegmentationProvider,
  type SegmentationProvider,
} from './segmentation/TransformersSegmentationProvider'
import type { MaskAlphaCache, MaskStatus, SegmentationKind } from './segmentation/types'

/**
 * Undo/redo wrapper around the editor reducer. Built once at module scope:
 * `undoable(editorReducer)` returns a fresh function on every call, so building
 * it inline in `useReducer` would recreate it on each render.
 */
const historyReducer = undoable(editorReducer)

interface EditorProviderProps {
  children: ReactNode
}

/**
 * Provides the shared editor store to the component tree. Seeds the adjustment
 * values from every slider group and the curves from the identity line.
 */
export function EditorProvider({ children }: EditorProviderProps) {
  const [history, dispatch] = useReducer(historyReducer, null, () =>
    initHistory({
      adjustments: buildInitialAdjustments(),
      curves: buildDefaultCurves(),
      image: null,
      imageStatus: 'idle' as const,
      imageDirty: false,
      cropRegion: null,
      cropRatio: 'Original',
      resetDialogOpen: false,
      masks: [],
      activeMaskId: null,
      orientation: {flipH: false, flipV: false, quarterTurns: 0}
    }),
  )
  // The full live state lives in `history.present`; everything below reads it.
  const state = history.present

  // Transient UI: hide the red mask overlay while a mask slider is being dragged
  // so the change is visible. Not part of the editor store (never undoable).
  const [maskOverlayHidden, setMaskOverlayHidden] = useState(false)

  // Canvas zoom/pan. Transient (never undoable), but shared: the crop overlay
  // draws on top of the canvas and must undo the very same transform.
  const [view, setView] = useState<CanvasView>(IDENTITY_VIEW)

  // One-shot spin signal for the canvas' rotation animation. Transient, like
  // `view`: it only cues a CSS transition, so it must not live in the history.
  // `spinId` mints a fresh id per turn so repeats re-fire the canvas effect.
  const [rotationSpin, setRotationSpin] = useState<RotationSpin | null>(null)
  const spinId = useRef(0)

  // Generated alphas for AI masks. A ref, not state: the pixels are heavy and
  // must stay out of the undo history, which only tracks each mask's `version`.
  // Consequence: filling it redraws nothing on its own — bump the mask's
  // `version` to produce the frame that uploads the alpha to the GPU.
  const maskAlphas = useRef<MaskAlphaCache>(new Map())

  // Per-mask segmentation progress. Transient UI, like `maskOverlayHidden`:
  // re-deriving it on undo/redo would mean re-running the model.
  const [maskStatus, setMaskStatus] = useState<Map<string, MaskStatus>>(new Map())

  // 0..100 while the model downloads, `null` otherwise. Global on purpose: one
  // model, fetched once, shared by every mask waiting at that moment.
  const [modelProgress, setModelProgress] = useState<number | null>(null)

  // The segmentation engine, built on first use. See `runSegmentation`.
  const providerRef = useRef<SegmentationProvider | null>(null)

  // Tear the worker (and its ONNX session) down with the app.
  useEffect(() => {
    return () => {
      providerRef.current?.dispose()
      providerRef.current = null
    }
  }, [])

  const setAdjustment = (key: string, value: number) => {
    dispatch({ type: 'SET', key, value })
  }

  const setCurve = (channel: ChannelId, points: CurvePoint[]) => {
    dispatch({ type: 'SET_CURVE', channel, points })
  }

  const resetCurves = () => {
    dispatch({ type: 'RESET_CURVES' })
  }

  const resetAdjustements = () => {
    dispatch({ type: 'RESET_ADJUSTEMENTS' })
  }

  const setCrop = (region: CropRegion | null) => {
    dispatch({ type: 'SET_CROP', cropRegion: region })
  }

  const clearCrop = () => {
    dispatch({ type: 'CLEAR_CROP' })
  }

  const setCropRatio = (ratio: string) => {
    dispatch({ type: 'SET_CROP_RATIO', ratio })
  }

  const openResetDialog = () => {
    dispatch({ type: 'OPEN_RESET_DIALOG' })
  }

  const closeResetDialog = () => {
    dispatch({ type: 'CLOSE_RESET_DIALOG' })
  }

  const undo = () => {
    dispatch({type: 'UNDO'})
  }

  const redo = () => {
    dispatch({type: 'REDO'})
  }

  const rotateCw = () => {
    dispatch({type: 'ROTATE_CW'})
    setRotationSpin({ direction: 'cw', id: ++spinId.current })
  }

  const rotateCcw = () => {
    dispatch({type: 'ROTATE_CCW'})
    setRotationSpin({ direction: 'ccw', id: ++spinId.current })
  }
  

   const flipH = () => {
    dispatch({type: 'FLIP_H'})
    setRotationSpin({ direction: 'flipH', id: ++spinId.current })
  }

  const flipV = () => {
    dispatch({type: 'FLIP_V'})
    setRotationSpin({ direction: 'flipV', id: ++spinId.current })
  }

  const resetOrientation = () => {
    dispatch({type: 'RESET_ORIENTATION'})
  }

  const commit = () => {
    dispatch({type: 'COMMIT'})
  }

  /**
   * Generates the alpha of an AI mask and hands it to the renderer.
   *
   * The target `version` is chosen by the caller rather than read from state:
   * this runs asynchronously, so `state` in this closure is a snapshot that may
   * already be stale by the time the alpha lands. Tagging the cache entry and
   * the mask with the same caller-supplied number means they cannot disagree.
   *
   * @param id - The mask to fill.
   * @param kind - Which segmentation to run.
   * @param version - The revision to publish the alpha under. Must differ from
   * the mask's current version, or the renderer will not notice it.
   */
  const runSegmentation = async (id: string, kind: SegmentationKind, version: number): Promise<void> => {
    try {
      const image = state.image
      if (image === null) return
      setMaskStatus((current) => new Map(current).set(id, 'loading'))
      // One provider for the whole app: each one owns a worker, and each worker
      // downloads the model again. Built on first use so a session that never
      // asks for an AI mask never fetches the inference runtime.
      const provider = (providerRef.current ??= new TransformersSegmentationProvider({
        onModelProgress: (progress) => {
          setModelProgress(progress.phase === 'downloading' ? progress.progress : null)
        },
      }))
      // The provider consumes the bitmap (it is transferred to its worker), so
      // it gets a clone — the store's own bitmap must stay drawable.
      const alpha = await provider.segment(await createImageBitmap(image.bitmap), kind)
      maskAlphas.current.set(id, { ...alpha, version })
      // The cache is a ref, so this dispatch is what actually causes the redraw
      // that uploads the alpha.
      dispatch({ type: 'SET_MASK_VERSION', id, version })
      setMaskStatus((current) => new Map(current).set(id, 'ready'))
    } catch (error) {
      logger.error(`Segmentation failed for mask ${id} (${kind})`, error)
      setMaskStatus((current) => new Map(current).set(id, 'error'))
    } finally {
      // Whatever happened, the download is over by now. Belt and braces: if the
      // 'ready' event ever stops arriving, the bar must not stick at 99%.
      setModelProgress(null)
    }
  }

  /**
   * Creates a mask of `type` with a unique default name ("Brush 1", "Sky 1", …),
   * appends it and selects it. AI masks additionally kick off their
   * segmentation. Returns the new id, or `null` if the cap blocked it (checked
   * here so the caller gets an accurate result before dispatch).
   */
  const addMask = (type: MaskType): string | null => {
    if (state.masks.length >= MAX_MASKS) return null
    const sameType = state.masks.filter((mask) => mask.type === type).length
    const mask = createMask(type, `${MASK_TYPE_LABEL[type]} ${sameType + 1}`)
    dispatch({ type: 'ADD_MASK', mask })
    if (type === 'subject' || type === 'sky') {
      // AI masks only. `mask` is brand new, so its version is known here without
      // reading state. (`brush` paints later; `linear` rasterises from geometry.)
      void runSegmentation(mask.id, type, mask.version + 1)
    }
    return mask.id
  }

  /**
   * Runs a mask's segmentation again after a failure. Reads the mask's current
   * version from state — safe here, because this is called from an event
   * handler, where `state` is the freshly rendered snapshot.
   *
   * @param id - The mask to retry. Ignored if it is gone or is not an AI mask.
   */
  const retryMask = (id: string): void => {
    const mask = state.masks.find((candidate) => candidate.id === id)
    if (mask === undefined || (mask.type !== 'subject' && mask.type !== 'sky')) return
    void runSegmentation(id, mask.type, mask.version + 1)
  }

  const removeMask = (id: string) => {
    dispatch({ type: 'REMOVE_MASK', id })
  }

  const setActiveMask = (id: string | null) => {
    dispatch({ type: 'SET_ACTIVE_MASK', id })
  }

  const setMaskAdjustment = (id: string, key: string, value: number) => {
    dispatch({ type: 'SET_MASK_ADJUSTMENT', id, key, value })
  }

  const setMaskInvert = (id: string, invert: boolean) => {
    dispatch({ type: 'SET_MASK_INVERT', id, invert })
  }

  const renameMask = (id: string, name: string) => {
    dispatch({ type: 'RENAME_MASK', id, name })
  }

  const addBrushStroke = (id: string, stroke: BrushStroke) => {
    dispatch({ type: 'ADD_BRUSH_STROKE', id, stroke })
  }

  const setMaskGradient = (id: string, gradient: GradientLine) => {
    dispatch({ type: 'SET_MASK_GRADIENT', id, gradient })
  }

  /**
   * Decodes a RAW file and stores the result for the canvas to draw. Runs the
   * async decode off the reducer (which stays pure); reports failures through
   * `imageStatus`.
   */
  const loadImage = async (file: File): Promise<void> => {
    try {
      dispatch({ type: 'SET_IMAGE_STATUS', status: 'loading' })
      // Free the previous decode before replacing it (RAW frames are large).
      state.image?.bitmap.close()
      const buffer = await file.arrayBuffer()
      const { data, width, height, metadata } = await decodeRaw(buffer)
      const imageData = new ImageData(rgbToRgba(data, width, height), width, height)
      const bitmap = await createImageBitmap(imageData)
      dispatch({
        type: 'SET_IMAGE',
        image: { bitmap, width, height, fileName: file.name, metadata },
      })
    } catch (error) {
      logger.error('loadImage failed', error)
      dispatch({ type: 'SET_IMAGE_STATUS', status: 'error' })
    }
  }

  return (
    <EditorContext
      value={{
        adjustments: state.adjustments,
        curves: state.curves,
        image: state.image,
        imageStatus: state.imageStatus,
        imageDirty: state.imageDirty,
        setAdjustment,
        setCurve,
        resetCurves,
        resetAdjustements,
        loadImage,
        cropRegion: state.cropRegion,
        setCrop,
        clearCrop,
        cropRatio: state.cropRatio,
        setCropRatio,
        resetDialogOpen: state.resetDialogOpen,
        openResetDialog,
        closeResetDialog,
        undo,
        redo,
        commit,
        canUndo: canUndo(history),
        canRedo: canRedo(history),
        masks: state.masks,
        activeMaskId: state.activeMaskId,
        addMask,
        removeMask,
        setActiveMask,
        setMaskAdjustment,
        setMaskInvert,
        renameMask,
        addBrushStroke,
        setMaskGradient,
        maskOverlayHidden,
        setMaskOverlayHidden,
        maskAlphas,
        maskStatus,
        modelProgress,
        retryMask,
        view,
        setView,
        orientation: state.orientation,
        rotateCw,
        rotateCcw,
        resetOrientation,
        flipV,
        flipH,
        rotationSpin
      }}
    >
      {children}
    </EditorContext>
  )
}

