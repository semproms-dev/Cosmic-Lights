import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint } from './curves'
import { type CropRegion } from './image'
import { IDENTITY_VIEW, type CanvasView } from './crop'
import { decodeImage } from './decodeImage'
import { EditorContext, type RotationSpin } from './editorContext'
import { editorReducer, buildInitialAdjustments } from './editorReducer'
import { logger } from '../logger'
import { canRedo, canUndo, initHistory, undoable } from './editorHistory'
import type { Preset } from './presets'
import { createMask, duplicateMask as cloneMask, DEFAULT_BRUSH, MASK_TYPE_LABEL, MAX_MASKS, type BrushSettings, type BrushStroke, type DuplicateMaskOptions, type GradientLine, type MaskType, type ObjectPrompt, type RadialShape } from './masks'
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
      orientation: {flipH: false, flipV: false, quarterTurns: 0, angleDeg: 0}
    }),
  )
  // The full live state lives in `history.present`; everything below reads it.
  const state = history.present

  // Transient UI: hide the red mask overlay while a mask slider is being dragged
  // so the change is visible. Not part of the editor store (never undoable).
  const [maskOverlayHidden, setMaskOverlayHidden] = useState(false)

  // Transient UI: whether the canvas shows the untouched original (default
  // sliders/curves, full frame) while the before/after control is held. Like
  // `maskOverlayHidden`, it only changes what gets rendered — never the undo
  // history or the live values.
  const [showOriginal, setShowOriginal] = useState(false)

  // Brush tool settings. Transient like the overlay flag: each stroke stores its
  // own radius/hardness/mode, so undo replays the mask exactly as painted no
  // matter where the tool sits now.
  const [brush, setBrushState] = useState<BrushSettings>(DEFAULT_BRUSH)

  /** Patches the brush settings, leaving the untouched fields alone. */
  const setBrush = (patch: Partial<BrushSettings>) => {
    setBrushState((current) => ({ ...current, ...patch }))
  }

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

  // Identifies the open image for the object model's embedding cache. A counter
  // rather than the image object itself: it crosses the worker boundary as a
  // plain number, and bumping it on every load is enough to invalidate the
  // (expensive) encoding of the previous image.
  const imageId = useRef(0)

  // Version of the last object segmentation requested per mask. Refining a
  // prompt fires a new request before the previous one answers, and the decoder
  // does not answer in order — this is what lets a stale alpha be dropped
  // instead of overwriting the newest one. A ref: it must be readable from the
  // async closure below, and it never affects rendering.
  const objectRequests = useRef<Map<string, number>>(new Map())

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

  const applyPreset = (preset: Preset) => {
    dispatch({ type: 'APPLY_PRESET', preset })
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

  const setMaskRadial = (id: string, radial: RadialShape) => {
    dispatch({ type: 'SET_MASK_RADIAL', id, radial });
  }

  const commit = () => {
    dispatch({type: 'COMMIT'})
  }

  /**
   * The app's single segmentation engine, built on first use. One provider owns
   * one worker, and every worker downloads its own copy of the models — so this
   * must stay a singleton, while still costing nothing to a session that never
   * asks for an AI mask.
   */
  const ensureProvider = (): SegmentationProvider =>
    (providerRef.current ??= new TransformersSegmentationProvider({
      onModelProgress: (progress) => {
        setModelProgress(progress.phase === 'downloading' ? progress.progress : null)
      },
    }))

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
      const provider = ensureProvider()
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
   * Generates the alpha of an `object` mask from the user's prompt.
   *
   * The sibling of {@link runSegmentation} for the promptable model, and it
   * differs in two ways: it runs on every prompt refinement rather than once,
   * and it can be overtaken — a slow decode must not overwrite the alpha of a
   * newer prompt, so the answer is dropped unless this is still the mask's
   * latest request.
   *
   * @param id - The mask to fill.
   * @param prompt - Points/box in normalised [0,1] image coordinates.
   * @param version - The revision to publish the alpha under, chosen by the
   * caller for the same reason as in {@link runSegmentation}.
   */
  const runObjectSegmentation = async (
    id: string,
    prompt: ObjectPrompt,
    version: number,
  ): Promise<void> => {
    try {
      const image = state.image
      if (image === null) return
      // Nothing pointed at yet: SAM has nothing to segment, and asking would
      // only produce an error state on a mask the user has just created.
      if (prompt.points.length === 0 && prompt.box === null) {
        setMaskStatus((current) => {
          const next = new Map(current)
          next.delete(id)
          return next
        })
        return
      }
      objectRequests.current.set(id, version)
      setMaskStatus((current) => new Map(current).set(id, 'loading'))
      const provider = ensureProvider()
      // A clone, like `runSegmentation`: the provider consumes the bitmap. From
      // the second prompt on it is released immediately (the image is already
      // encoded) — a wasted clone per click, but the store's bitmap stays safe.
      const alpha = await provider.segmentObject(
        await createImageBitmap(image.bitmap),
        imageId.current,
        prompt,
      )
      // Overtaken by a newer prompt while the decoder ran: its alpha is the one
      // the user is waiting for, so this stale one is dropped, status included.
      if (objectRequests.current.get(id) !== version) return
      maskAlphas.current.set(id, { ...alpha, version })
      // The mask already carries this version (`SET_MASK_PROMPT` bumped it), but
      // the cache is a ref: this dispatch is what produces the frame that
      // uploads the alpha to the GPU.
      dispatch({ type: 'SET_MASK_VERSION', id, version })
      setMaskStatus((current) => new Map(current).set(id, 'ready'))
    } catch (error) {
      logger.error(`Object segmentation failed for mask ${id}`, error)
      if (objectRequests.current.get(id) !== version) return
      setMaskStatus((current) => new Map(current).set(id, 'error'))
    } finally {
      setModelProgress(null)
    }
  }

  /**
   * Records the user's prompt for an `object` mask and re-segments it. Called on
   * every refinement (a click, a shift-click, a box), so the mask follows the
   * pointing live.
   *
   * @param id - The object mask being prompted. Ignored if it is gone.
   * @param prompt - Points/box in normalised [0,1] image coordinates.
   */
  const setObjectPrompt = (id: string, prompt: ObjectPrompt): void => {
    const mask = state.masks.find((candidate) => candidate.id === id)
    if (mask === undefined) return
    dispatch({ type: 'SET_MASK_PROMPT', id, prompt })
    // The reducer increments the version, so the alpha must be published under
    // that same next number for the renderer to accept it.
    void runObjectSegmentation(id, prompt, mask.version + 1)
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
      // Automatic AI masks only. `mask` is brand new, so its version is known
      // here without reading state. (`brush` paints later; `linear`/`radial`
      // rasterise from geometry; `object` waits for the user to point at
      // something — see `setObjectPrompt`.)
      void runSegmentation(mask.id, type, mask.version + 1)
    }
    return mask.id
  }

  /**
   * Copies an existing mask, appends it and selects it.
   *
   * This lives here rather than beside the pure {@link cloneMask} because of the
   * alpha: an AI mask's pixels are not in the mask at all, they are in
   * `maskAlphas` keyed by id, and the copy has a new id. Carrying that entry
   * across is what makes an `object` copy render — it has no way to rebuild
   * itself, since its alpha came from a model run against a prompt, not from
   * geometry. Copying it also spares `subject`/`sky` a second inference for
   * pixels already in memory.
   *
   * A mask whose alpha has not arrived yet is not copied: the duplicate would be
   * permanently empty (nothing would ever fill its cache entry), so the caller
   * is told `null` rather than being handed a dead mask.
   *
   * @param id - The mask to copy. `null` if it is gone, still segmenting, or the
   * cap is reached.
   * @param name - Display name for the copy; the caller owns it, being the side
   * that can translate.
   * @param options - Passed straight to {@link cloneMask}.
   * @returns The new mask's id, or `null` if nothing was added.
   */
  const duplicateMask = (id: string, name: string, options?: DuplicateMaskOptions): string | null => {
    if (state.masks.length >= MAX_MASKS) return null
    const source = state.masks.find((mask) => mask.id === id)
    if (source === undefined) return null
    const alpha = maskAlphas.current.get(id)
    const needsAlpha = source.type === 'subject' || source.type === 'sky' || source.type === 'object'
    if (needsAlpha && alpha === undefined) return null

    const copy = cloneMask(source, name, options)
    if (alpha !== undefined) maskAlphas.current.set(copy.id, alpha)
    // Inherit the source's status so the copy is not mistaken for a mask that
    // never ran. No segmentation is started: its alpha is already in the cache.
    const status = maskStatus.get(id)
    if (status !== undefined) setMaskStatus((current) => new Map(current).set(copy.id, status))
    dispatch({ type: 'ADD_MASK', mask: copy })
    return copy.id
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
    if (mask === undefined) return
    if (mask.type === 'subject' || mask.type === 'sky') {
      void runSegmentation(id, mask.type, mask.version + 1)
      return
    }
    // An object mask re-runs against the prompt it already has: the user should
    // not have to point at the object again because the model download failed.
    if (mask.type === 'object' && mask.prompt !== null) {
      void runObjectSegmentation(id, mask.prompt, mask.version + 1)
    }
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

  const setRotationAngle = (angleDeg: number) => {
    dispatch({ type: 'SET_ROTATION_ANGLE', angleDeg })
  }

  /**
   * Decodes a photo and stores the result for the canvas to draw. Runs the async
   * decode off the reducer (which stays pure); reports failures through
   * `imageStatus`.
   *
   * Which decoder runs, and how a mislabelled file is rescued, is `decodeImage`'s
   * business; this only stores what came back. `metadata` stays null when the
   * file genuinely carries none, and `source` records which decoder won, so
   * nothing downstream has to guess from the file name.
   */
  const loadImage = async (file: File): Promise<void> => {
    try {
      dispatch({ type: 'SET_IMAGE_STATUS', status: 'loading' })
      const decoded = await decodeImage(file)
      // Only now is the previous frame safe to free (frames are large). Closing
      // it before the decode would leave the canvas holding a closed bitmap on
      // every failed open — and a file that no decoder accepts is a path that
      // really happens.
      state.image?.bitmap.close()
      // A different image invalidates the object model's cached encoding: reuse
      // it and every prompt would be decoded against the previous photo.
      imageId.current += 1
      dispatch({
        type: 'SET_IMAGE',
        image: {
          bitmap: decoded.bitmap,
          width: decoded.bitmap.width,
          height: decoded.bitmap.height,
          fileName: file.name,
          metadata: decoded.metadata,
          source: decoded.source,
          noise: decoded.noise,
        },
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
        applyPreset,
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
        // The checkpoint object itself: the reducer builds a new one only when a
        // COMMIT actually changed something, which is exactly the signal.
        commitToken: history.checkpoint,
        canUndo: canUndo(history),
        canRedo: canRedo(history),
        masks: state.masks,
        activeMaskId: state.activeMaskId,
        addMask,
        duplicateMask,
        removeMask,
        setActiveMask,
        setMaskAdjustment,
        setMaskInvert,
        renameMask,
        addBrushStroke,
        brush,
        setBrush,
        setMaskGradient,
        setObjectPrompt,
        maskOverlayHidden,
        setMaskOverlayHidden,
        showOriginal,
        setShowOriginal,
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
        rotationSpin,
        setMaskRadial,
        setRotationAngle,
        angle: state.orientation.angleDeg
      }}
    >
      {children}
    </EditorContext>
  )
}

