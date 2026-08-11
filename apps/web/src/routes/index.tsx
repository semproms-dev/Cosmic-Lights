import { useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useFullscreenDocument } from '@mantine/hooks'
import { NavBar } from '../components/navigation/elements/TopNavBar'
import { LateralNavBar } from '../components/navigation/elements/LateralNavBar'
import { AdjustmentsPanel } from '../components/sliders/elements/AdjustmentsPanel'
import { InfoPanel } from '../components/panels/InfoPanel'
import { CropPanel } from '../components/panels/CropPanel/CropPanel'
import { ExportPanel } from '../components/panels/ExportPanel'
import { ShortcutsPanel } from '../components/panels/ShortcutsPanel'
import { MasksPanel } from '../components/panels/MasksPanel'
import { Presets } from '../components/panels/Presets'
import { OpenImageButton } from '../components/canvas/OpenImageButton'
import { Canvas } from '../components/canvas/Canvas'
import classes from './index.module.css'
import { LoadingOverlay } from '@mantine/core'
import { useEditor } from '../editor/editorContext'
import { usePreferences } from '../preferences/preferences'
import { useEditorShortcuts } from '../editor/useEditorShortcuts'
import { CropOverlay } from '../editor/CropOverlay'
import { GradientOverlay } from '../editor/GradientOverlay'
import { RadialOverlay } from '../editor/RadialOverlay'
import { ObjectPromptOverlay } from '../editor/ObjectPromptOverlay'

export const Route = createFileRoute('/')({
  component: HomePage,
})

/**
 * Tool panels keyed by their rail nav key. A tool without an entry opens no panel.
 */
const PANELS: Record<string, ComponentType> = {
  info: InfoPanel,
  adjustments: AdjustmentsPanel,
  masks: MasksPanel,
  crop: CropPanel,
  shortcuts: ShortcutsPanel,
  presets: Presets,
  export: ExportPanel,
}

/**
 * Landing page for CosmicLights.
 */
function HomePage() {
  const [activeTool, setActiveTool] = useState('adjustments')
  const {imageStatus, masks, activeMaskId, maskOverlayHidden} = useEditor();
  const { preferences } = usePreferences();
  const { fullscreen, toggle } = useFullscreenDocument();
  const fileInputRef = useRef<HTMLInputElement>(null)

  // When the Masks tool is open and a brush mask is selected, the canvas paints
  // that mask on drag instead of panning. Any other case → no painting (null).
  const activeMask = masks.find((m) => m.id === activeMaskId) ?? null
  const brushMaskId =
    activeTool === 'masks' && activeMask?.type === 'brush' ? activeMask.id : null
  // Same idea for a linear-gradient mask: a drag defines its ramp instead of panning.
  const gradientMaskId =
    activeTool === 'masks' && activeMask?.type === 'linear' ? activeMask.id : null
  // And for a radial-gradient mask: a drag defines its ellipse instead of panning.
  const radialMaskId =
    activeTool === 'masks' && activeMask?.type === 'radial' ? activeMask.id : null
  // Show the selected mask as a red overlay whenever the Masks tool is open,
  // except while a mask slider is being dragged (so the change stays visible).
  const overlayMaskId =
    activeTool === 'masks' && !maskOverlayHidden ? activeMaskId : null

  // And for a promptable object mask: a click points at the object, a drag boxes it.
  const objectMaskId =
    activeTool === 'masks' && activeMask?.type === 'object' ? activeMask.id : null

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
    showShortcuts: () => setActiveTool('shortcuts'),
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
      }}
    >
      <NavBar onOpenImage={() => fileInputRef.current?.click()} fullScreen={fullscreen} onToggleFullScreen={toggle} />
      <OpenImageButton fileInputRef={fileInputRef} />
      <div style={{ display: 'flex', flexDirection: rowDirection, flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <LoadingOverlay visible={imageStatus === 'loading'}/>
          <Canvas 
            cropping={activeTool === 'crop'} 
            brushMaskId={brushMaskId} 
            gradientMaskId={gradientMaskId} 
            radialMaskId={radialMaskId} 
            overlayMaskId={overlayMaskId}
            objectMaskId={objectMaskId}
          />
          {activeTool === 'crop' && <CropOverlay onDone={() => setActiveTool('')} />}
          {gradientMaskId !== null && <GradientOverlay maskId={gradientMaskId} />}
          {radialMaskId !== null && <RadialOverlay maskId={radialMaskId} />}
          {objectMaskId !== null && <ObjectPromptOverlay maskId={objectMaskId} />}
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
