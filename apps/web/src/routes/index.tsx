import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { NavBar } from '../components/navigation/elements/TopNavBar'
import { LateralNavBar } from '../components/navigation/elements/LateralNavBar'

export const Route = createFileRoute('/')({
  component: HomePage,
})

/**
 * Landing page for CosmicLights.
 */
function HomePage() {
  const [activeTool, setActiveTool] = useState('Adjustments')

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <NavBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1 }}>{/* editor canvas */}</div>
        <LateralNavBar active={activeTool} onChange={setActiveTool} />
      </div>
    </main>
  )
}
