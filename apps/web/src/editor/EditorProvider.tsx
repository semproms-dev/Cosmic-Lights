import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint } from './curves'
import { rgbToRgba, type CropRegion } from './image'
import { decodeRaw } from './decodeRaw'
import { EditorContext } from './editorContext'
import { editorReducer, buildInitialAdjustments } from './editorReducer'
import { logger } from '../logger'
import { canRedo, canUndo, initHistory, undoable } from './editorHistory'

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
    }),
  )
  // The full live state lives in `history.present`; everything below reads it.
  const state = history.present

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

  const commit = () => {
    dispatch({type: 'COMMIT'})
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
      }}
    >
      {children}
    </EditorContext>
  )
}

