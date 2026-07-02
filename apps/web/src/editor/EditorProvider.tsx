import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint } from './curves'
import { rgbToRgba } from './image'
import { decodeRaw } from './decodeRaw'
import { EditorContext } from './editorContext'
import { editorReducer, buildInitialAdjustments } from './editorReducer'
import { logger } from '../logger'

interface EditorProviderProps {
  children: ReactNode
}

/**
 * Provides the shared editor store to the component tree. Seeds the adjustment
 * values from every slider group and the curves from the identity line.
 */
export function EditorProvider({ children }: EditorProviderProps) {
  const [state, dispatch] = useReducer(editorReducer, null, () => ({
    adjustments: buildInitialAdjustments(),
    curves: buildDefaultCurves(),
    image: null,
    imageStatus: 'idle' as const,
  }))

  const setAdjustment = (key: string, value: number) => {
    dispatch({ type: 'SET', key, value })
  }

  const setCurve = (channel: ChannelId, points: CurvePoint[]) => {
    dispatch({ type: 'SET_CURVE', channel, points })
  }

  const resetCurves = () => {
    dispatch({ type: 'RESET_CURVES' })
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
        setAdjustment,
        setCurve,
        resetCurves,
        loadImage,
      }}
    >
      {children}
    </EditorContext>
  )
}

