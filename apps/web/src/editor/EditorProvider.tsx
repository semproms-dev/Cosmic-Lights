import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { buildDefaultCurves } from './curves'
import type { ChannelId, CurvePoint } from './curves'
import { EditorContext } from './editorContext'
import { editorReducer, buildInitialAdjustments } from './editorReducer'

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

  return (
    <EditorContext
      value={{
        adjustments: state.adjustments,
        curves: state.curves,
        setAdjustment,
        setCurve,
        resetCurves,
      }}
    >
      {children}
    </EditorContext>
  )
}
