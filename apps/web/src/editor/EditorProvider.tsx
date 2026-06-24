import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { basicAdjustments, buildDefaults } from './adjustments'
import { EditorContext } from './editorContext'

interface EditorProviderProps {
  children: ReactNode
}

/**
 * Provides the shared editor store to the component tree. Seeds the adjustment
 * values from the Basic slider defaults.
 */
export function EditorProvider({ children }: EditorProviderProps) {
  const [adjustments, setAdjustments] = useState<Record<string, number>>(() =>
    buildDefaults(basicAdjustments),
  )

  const setAdjustment = useCallback((key: string, value: number) => {
    setAdjustments((previous) => ({ ...previous, [key]: value }))
  }, [])

  const resetAdjustments = useCallback(() => {
    setAdjustments(buildDefaults(basicAdjustments))
  }, [])

  const value = useMemo(
    () => ({ adjustments, setAdjustment, resetAdjustments }),
    [adjustments, setAdjustment, resetAdjustments],
  )

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
