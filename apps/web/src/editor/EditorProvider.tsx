import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { basicAdjustments, buildDefaults } from './adjustments'
import { EditorContext } from './editorContext'
import { editorReducer } from './editorReducer'

interface EditorProviderProps {
  children: ReactNode
}

/**
 * Provides the shared editor store to the component tree. Seeds the adjustment
 * values from the Basic slider defaults.
 */
export function EditorProvider({ children }: EditorProviderProps) {
  const [adjustments, dispatch] = useReducer(
    editorReducer,
    null,
    () => buildDefaults(basicAdjustments),
  )

  const setAdjustment = (key: string, value: number) => {
    dispatch({ type: 'SET', key, value })
  }

  const resetAdjustments = () => {
    dispatch({ type: 'RESET' })
  }

  return (
    <EditorContext value={{ adjustments, setAdjustment, resetAdjustments }}>
      {children}
    </EditorContext>
  )
}
