import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MantineProvider } from '@mantine/core'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BUILTIN_PRESETS } from '../../editor/presets'
import '../../i18n'

// Controlled editor store: the test drives whether an image is open and spies on
// the actions the panel triggers. `vi.hoisted` keeps the refs reachable from the
// (hoisted) `vi.mock` factory.
const { applyPreset, commit, state } = vi.hoisted(() => ({
  applyPreset: vi.fn(),
  commit: vi.fn(),
  state: { image: null as { width: number; height: number } | null },
}))

vi.mock('../../editor/editorContext', () => ({
  useEditor: () => ({
    image: state.image,
    applyPreset,
    commit,
  }),
}))

// The real hook needs a WebGL2 context, which jsdom has no business providing:
// the thumbnails are the renderer's job, not the panel's.
vi.mock('../../editor/usePresetThumbnails', () => ({
  usePresetThumbnails: () => new Map([[BUILTIN_PRESETS[0].id, 'data:image/jpeg;base64,AAA']]),
}))

import { Presets } from './Presets'

function renderPanel(): void {
  render(<Presets />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MantineProvider defaultColorScheme="dark">{children}</MantineProvider>
    ),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.image = { width: 100, height: 80 }
})

describe('Presets', () => {
  it('lists every preset of the catalogue', () => {
    renderPanel()

    for (const preset of BUILTIN_PRESETS) {
      expect(screen.getByText(preset.name)).toBeInTheDocument()
    }
  })

  it('opens one folder per family, in order and with its count', () => {
    renderPanel()

    // Las carpetas son los únicos botones con estado de despliegue; buscarlas
    // por nombre pescaría también la fila «Dramatic B&W».
    const folders = screen.getAllByRole('button', { expanded: true })
    expect(folders.map((folder) => folder.textContent)).toEqual([
      'Style2',
      'Color2',
      'B&W2',
      'Lights3',
      'Movies3',
    ])
    // El orden es el de PRESET_KINDS, no el del catálogo: `Cinematic` abre el
    // catálogo y es Style, pero `Black & White` va antes que los de cine
    // aunque en el array esté después.
    expect(folders).toHaveLength(new Set(BUILTIN_PRESETS.map((p) => p.kind)).size)
  })

  it('applies the clicked preset and checkpoints it as one undo step', () => {
    renderPanel()

    fireEvent.click(screen.getByText(BUILTIN_PRESETS[0].name))

    expect(applyPreset).toHaveBeenCalledWith(BUILTIN_PRESETS[0])
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('shows the rendered thumbnail and nothing for the presets still pending', () => {
    renderPanel()

    const images = screen.getAllByRole('presentation')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', 'data:image/jpeg;base64,AAA')
  })

  it('collapses and re-expands a folder on its own', () => {
    renderPanel()

    fireEvent.click(screen.getByText('Movies'))
    // Mantine's Collapse keeps the rows mounted, so the panel is what reports
    // the state — the aria-expanded of the folder button.
    expect(screen.getByRole('button', { name: /Movies/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /Style/ })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByText('Movies'))
    expect(screen.getByRole('button', { name: /Movies/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('does nothing with no image open, and says why', () => {
    state.image = null
    renderPanel()

    expect(screen.getByText('Open an image to preview the presets.')).toBeInTheDocument()

    fireEvent.click(screen.getByText(BUILTIN_PRESETS[0].name))

    expect(applyPreset).not.toHaveBeenCalled()
  })
})
