import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '../../test/render'
import userEvent from '@testing-library/user-event'
import { Canvas } from './Canvas'
import { useEditor } from '../../editor/editorContext'
import type { Orientation } from '../../editor/rotation'

/**
 * Every orientation the canvas has pushed to the GPU, oldest first. Lives in
 * `vi.hoisted` because `vi.mock` factories run before the module body.
 */
const gpu = vi.hoisted(() => ({
  orientations: [] as Orientation[],
  views: [] as { scale: number; offsetX: number; offsetY: number }[],
}))

// The renderer is the whole point of this file: jsdom has no WebGL2, so the real
// one can never be built here. A stub that only records what it was told keeps
// the assertions on the one question these tests ask — does the state reach the
// GPU? Any method the canvas calls but this file does not care about resolves to
// a no-op through the proxy.
vi.mock('../../editor/gl/renderer', () => ({
  WebGLRenderer: class {
    constructor() {
      return new Proxy(
        {
          setOrientation: (orientation: Orientation) => {
            gpu.orientations.push(orientation)
          },
          setView: (scale: number, offsetX: number, offsetY: number) => {
            gpu.views.push({ scale, offsetX, offsetY })
          },
        } as Record<string, unknown>,
        { get: (target, key) => target[key as string] ?? (() => undefined) },
      )
    }
  },
}))

// Decoding is a worker + LibRaw away; the store only needs something bitmap-shaped.
vi.mock('../../editor/decodeImage', () => ({
  decodeImage: vi.fn(async () => ({
    bitmap: { width: 300, height: 200, close: () => undefined },
    metadata: null,
    source: 'developed' as const,
    noise: null,
    histogram: null,
  })),
}))

/** Drives the store from inside the provider, for steps with no UI in Canvas. */
function Harness() {
  const {
    loadImage,
    setRotationAngle,
    openResetDialog,
    commit,
    setView,
    setCropRatio,
    cropRatio,
    canUndo,
    undo,
    orientation,
  } = useEditor()
  return (
    <>
      <output data-testid="ratio">{cropRatio}</output>
      <output data-testid="angle">{orientation.angleDeg}</output>
      <button onClick={() => void loadImage(new File([], 'photo.jpg'))}>load</button>
      <button onClick={() => setCropRatio('16:9')}>ratio 16:9</button>
      <button disabled={!canUndo} onClick={() => undo()}>undo</button>
      <button
        onClick={() => {
          setRotationAngle(12)
          commit()
        }}
      >
        straighten
      </button>
      <button onClick={() => setView({ scale: 3, offsetX: 0.4, offsetY: -0.2 })}>zoom</button>
      <button onClick={() => openResetDialog()}>open reset</button>
    </>
  )
}

/** The orientation the canvas last handed to the GPU. */
const lastOrientation = (): Orientation | undefined => gpu.orientations.at(-1)

describe('Canvas — reset', () => {
  beforeEach(() => {
    gpu.orientations = []
    // jsdom's canvas has no getContext at all; the renderer above ignores it.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('puts the photo back upright on the canvas, not just in the panel', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <Canvas />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'load' }))
    await user.click(screen.getByRole('button', { name: 'straighten' }))
    await waitFor(() => {
      expect(lastOrientation()?.angleDeg).toBe(12)
    })

    await user.click(screen.getByRole('button', { name: 'open reset' }))
    // The dialog is a Mantine modal: it mounts a frame after the state flips.
    await user.click(await screen.findByRole('button', { name: 'Reset' }))

    // The straighten has to reach the GPU again as 0°, or the panel reads
    // upright while the canvas keeps showing the photo tilted.
    await waitFor(() => {
      expect(lastOrientation()?.angleDeg).toBe(0)
    })
  })

  it('puts the zoom and the pan back to the fitted view', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <Canvas />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'load' }))
    await user.click(screen.getByRole('button', { name: 'zoom' }))
    await waitFor(() => {
      expect(gpu.views.at(-1)?.scale).toBe(3)
    })

    await user.click(screen.getByRole('button', { name: 'open reset' }))
    await user.click(await screen.findByRole('button', { name: 'Reset' }))

    await waitFor(() => {
      expect(gpu.views.at(-1)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 })
    })
  })

  it('drops the crop ratio too, so the next crop is not still locked to it', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <Canvas />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'load' }))
    await user.click(screen.getByRole('button', { name: 'ratio 16:9' }))
    expect(screen.getByTestId('ratio')).toHaveTextContent('16:9')

    await user.click(screen.getByRole('button', { name: 'open reset' }))
    await user.click(await screen.findByRole('button', { name: 'Reset' }))

    expect(screen.getByTestId('ratio')).toHaveTextContent('Original')
  })

  it('files the reset in the history, so undo brings the edit back', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness />
        <Canvas />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'load' }))
    await user.click(screen.getByRole('button', { name: 'straighten' }))
    expect(screen.getByTestId('angle')).toHaveTextContent('12')

    await user.click(screen.getByRole('button', { name: 'open reset' }))
    await user.click(await screen.findByRole('button', { name: 'Reset' }))
    expect(screen.getByTestId('angle')).toHaveTextContent('0')

    // Undo has to land on the straightened photo. Without the COMMIT the reset
    // never became a checkpoint, so this would restore the state from *before*
    // the straighten — the reset itself would be unundoable.
    await user.click(screen.getByRole('button', { name: 'undo' }))
    expect(screen.getByTestId('angle')).toHaveTextContent('12')
  })
})
