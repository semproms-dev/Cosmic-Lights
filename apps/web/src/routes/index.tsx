import { useState } from 'react'
import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { NavBar } from '../components/navigation/elements/TopNavBar'
import { LateralNavBar } from '../components/navigation/elements/LateralNavBar'
import { AdjustmentsPanel } from '../components/sliders/elements/AdjustmentsPanel'
import { InfoPanel } from '../components/panels/InfoPanel'
import { CropPanel } from '../components/panels/CropPanel'
import { ExportPanel } from '../components/panels/ExportPanel'
import { Canvas } from '../components/canvas/Canvas'
import classes from './index.module.css'
import { LoadingOverlay } from '@mantine/core'
import { useEditor } from '../editor/editorContext'
import { CropOverlay } from '../editor/CropOverlay'

export const Route = createFileRoute('/')({
  component: HomePage,
})

/**
 * Tool panels keyed by their rail label. A tool without an entry opens no panel.
 */
const PANELS: Record<string, ComponentType> = {
  Info: InfoPanel,
  Adjustments: AdjustmentsPanel,
  Crop: CropPanel,
  Export: ExportPanel,
}

/**
 * Landing page for CosmicLights.
 */
function HomePage() {
  const [activeTool, setActiveTool] = useState('Adjustments')
  const {imageStatus} = useEditor();

  /**
   * Selecting a tool opens its panel; selecting the already-active tool toggles
   * the panel closed (empty string = nothing selected).
   */
  const handleToolChange = (label: string) => {
    setActiveTool((current) => (current === label ? '' : label))
  }

  const ActivePanel = PANELS[activeTool]

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <NavBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <LoadingOverlay visible={imageStatus === 'loading'}/>
          <Canvas />
          {activeTool === 'Crop' && <CropOverlay onDone={() => setActiveTool('')} />}
        </div>
        {ActivePanel && (
          <aside className={classes.panel} aria-label={`${activeTool} panel`}>
            <ActivePanel />
          </aside>
        )}
        <LateralNavBar active={activeTool} onChange={handleToolChange} />
      </div>
    </main>
  )
}
