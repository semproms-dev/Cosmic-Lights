import { useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { NavBar } from '../components/navigation/elements/TopNavBar'
import { LateralNavBar } from '../components/navigation/elements/LateralNavBar'
import { AdjustmentsPanel } from '../components/sliders/elements/AdjustmentsPanel'
import { InfoPanel } from '../components/panels/InfoPanel'
import { CropPanel } from '../components/panels/CropPanel'
import { ExportPanel } from '../components/panels/ExportPanel'
import { ShortcutsPanel } from '../components/panels/ShortcutsPanel'
import { OpenImageButton } from '../components/canvas/OpenImageButton'
import { Canvas } from '../components/canvas/Canvas'
import classes from './index.module.css'
import { LoadingOverlay } from '@mantine/core'
import { useEditor } from '../editor/editorContext'
import { usePreferences } from '../preferences/preferences'
import { useEditorShortcuts } from '../editor/useEditorShortcuts'
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
  Shortcuts: ShortcutsPanel,
  Export: ExportPanel,
}

/**
 * Landing page for CosmicLights.
 */
function HomePage() {
  const [activeTool, setActiveTool] = useState('Adjustments')
  const {imageStatus} = useEditor();
  const { preferences } = usePreferences();
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Selecting a tool opens its panel; selecting the already-active tool toggles
   * the panel closed (empty string = nothing selected).
   */
  const handleToolChange = (label: string) => {
    setActiveTool((current) => (current === label ? '' : label))
  }

  // Global keyboard shortcuts. Opening an image clicks the picker owned by the
  // NavBar's OpenImageButton; the reset shortcut opens the confirm dialog.
  useEditorShortcuts({
    openImage: () => fileInputRef.current?.click(),
    showShortcuts: () => setActiveTool('Shortcuts'),
  })

  const ActivePanel = PANELS[activeTool]

  // The tool rail and its panel default to the right; 'left' just reverses the
  // editor row so the rail (last child) ends up first, on the left.
  const rowDirection = preferences.panelPosition === 'left' ? 'row-reverse' : 'row'

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontSize: `${preferences.fontSize}px`,
      }}
    >
      <NavBar onOpenImage={() => fileInputRef.current?.click()} />
      <OpenImageButton fileInputRef={fileInputRef} />
      <div style={{ display: 'flex', flexDirection: rowDirection, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <LoadingOverlay visible={imageStatus === 'loading'}/>
          <Canvas cropping={activeTool === 'Crop'} />
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
