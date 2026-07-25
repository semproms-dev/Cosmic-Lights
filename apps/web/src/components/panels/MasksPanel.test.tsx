import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MantineProvider } from '@mantine/core'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMask, type Mask } from '../../editor/masks'
import type { MaskStatus } from '../../editor/segmentation/types'
import '../../i18n'

// Controlled editor store: the test drives the masks and their segmentation
// status, and spies on the actions the panel triggers. `vi.hoisted` keeps the
// refs reachable from the (hoisted) `vi.mock` factory.
const { retryMask, addMask, setObjectPrompt, state } = vi.hoisted(() => ({
  retryMask: vi.fn(),
  addMask: vi.fn(),
  setObjectPrompt: vi.fn(),
  state: {
    masks: [] as Mask[],
    activeMaskId: null as string | null,
    maskStatus: new Map<string, MaskStatus>(),
    modelProgress: null as number | null,
  },
}))

vi.mock('../../editor/editorContext', () => ({
  useEditor: () => ({
    image: { width: 100, height: 100 },
    masks: state.masks,
    activeMaskId: state.activeMaskId,
    maskStatus: state.maskStatus,
    modelProgress: state.modelProgress,
    addMask,
    retryMask,
    setObjectPrompt,
    removeMask: vi.fn(),
    setActiveMask: vi.fn(),
    setMaskAdjustment: vi.fn(),
    setMaskInvert: vi.fn(),
    commit: vi.fn(),
    setMaskOverlayHidden: vi.fn(),
  }),
}))

import { MasksPanel } from './MasksPanel'

function renderPanel(): void {
  render(<MasksPanel />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MantineProvider defaultColorScheme="dark">{children}</MantineProvider>
    ),
  })
}

describe('MasksPanel', () => {
  beforeEach(() => {
    retryMask.mockClear()
    addMask.mockClear()
    setObjectPrompt.mockClear()
    state.masks = []
    state.activeMaskId = null
    state.maskStatus = new Map()
    state.modelProgress = null
  })

  it('tells the user it is downloading, with a percentage, while the model loads', () => {
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.maskStatus = new Map([[mask.id, 'loading']])
    state.modelProgress = 42

    renderPanel()

    expect(screen.getByText('Downloading model… 42%')).toBeInTheDocument()
  })

  it('says it is segmenting once the model is no longer downloading', () => {
    // The distinction matters: the download is slow once and reports progress;
    // inference is slow every time and has none.
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.maskStatus = new Map([[mask.id, 'loading']])
    state.modelProgress = null

    renderPanel()

    expect(screen.getByText('Segmenting…')).toBeInTheDocument()
    expect(screen.queryByText(/Downloading model/)).not.toBeInTheDocument()
  })

  it('rounds a fractional progress instead of showing decimals', () => {
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.maskStatus = new Map([[mask.id, 'loading']])
    state.modelProgress = 66.6666

    renderPanel()

    expect(screen.getByText('Downloading model… 67%')).toBeInTheDocument()
  })

  it('offers a retry on a failed mask and calls it with that mask id', () => {
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.maskStatus = new Map([[mask.id, 'error']])

    renderPanel()

    expect(screen.getByText('Segmentation failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(retryMask).toHaveBeenCalledWith(mask.id)
  })

  it('shows no status chrome on a ready mask', () => {
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.maskStatus = new Map([[mask.id, 'ready']])

    renderPanel()

    expect(screen.queryByText('Segmenting…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('leaves a brush mask, which has no status, free of segmentation chrome', () => {
    const mask = createMask('brush', 'Brush 1')
    state.masks = [mask]

    renderPanel()

    expect(screen.queryByText('Segmenting…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('disables the sliders of a mask that has no alpha yet', () => {
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.activeMaskId = mask.id
    state.maskStatus = new Map([[mask.id, 'loading']])

    renderPanel()

    // Sliders with nothing to act on would silently do nothing, which reads as
    // a broken control rather than as "not ready yet".
    expect(screen.getByRole('switch', { name: 'Invert' })).toBeDisabled()
  })

  it('enables the sliders once the mask is ready', () => {
    const mask = createMask('subject', 'Subject 1')
    state.masks = [mask]
    state.activeMaskId = mask.id
    state.maskStatus = new Map([[mask.id, 'ready']])

    renderPanel()

    expect(screen.getByRole('switch', { name: 'Invert' })).not.toBeDisabled()
  })

  it('tells the user to point at something when an object mask has no prompt', () => {
    // The mask is waiting on the canvas, not on the model: it has no status and
    // no spinner, so without this line nothing explains the dead controls.
    const mask = createMask('object', 'Select object 1')
    state.masks = [mask]
    state.activeMaskId = mask.id

    renderPanel()

    expect(screen.getByText(/Click the object/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Invert' })).toBeDisabled()
  })

  it('drops the hint and enables the controls once the object has been pointed at', () => {
    const mask: Mask = {
      ...createMask('object', 'Select object 1'),
      prompt: { points: [{ x: 0.5, y: 0.5, label: 1 }], box: null },
    }
    state.masks = [mask]
    state.activeMaskId = mask.id
    state.maskStatus = new Map([[mask.id, 'ready']])

    renderPanel()

    expect(screen.queryByText(/Click the object/)).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Invert' })).not.toBeDisabled()
  })

  it('keeps the object mask disabled while its first segmentation runs', () => {
    const mask: Mask = {
      ...createMask('object', 'Select object 1'),
      prompt: { points: [{ x: 0.5, y: 0.5, label: 1 }], box: null },
    }
    state.masks = [mask]
    state.activeMaskId = mask.id
    state.maskStatus = new Map([[mask.id, 'loading']])

    renderPanel()

    expect(screen.getByText('Segmenting…')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Invert' })).toBeDisabled()
  })

  it('lets the user pick which reading of the click to keep', () => {
    // One click means the eye, the face and the person at once, and the model's
    // confidence does not rank them by intent — so the choice is the user's.
    const mask: Mask = {
      ...createMask('object', 'Select object 1'),
      prompt: { points: [{ x: 0.5, y: 0.5, label: 1 }], box: null },
    }
    state.masks = [mask]
    state.activeMaskId = mask.id
    state.maskStatus = new Map([[mask.id, 'ready']])

    renderPanel()

    fireEvent.click(screen.getByText('Detail'))

    expect(setObjectPrompt).toHaveBeenCalledWith(mask.id, {
      points: [{ x: 0.5, y: 0.5, label: 1 }],
      box: null,
      granularity: 'detail',
    })
  })

  it('offers no granularity control until something has been pointed at', () => {
    const mask = createMask('object', 'Select object 1')
    state.masks = [mask]
    state.activeMaskId = mask.id

    renderPanel()

    expect(screen.queryByText('Detail')).not.toBeInTheDocument()
  })
})
