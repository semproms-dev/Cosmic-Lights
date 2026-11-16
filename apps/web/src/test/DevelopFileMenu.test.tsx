import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from './render'
import userEvent from '@testing-library/user-event'
import { DevelopFileMenu } from '../components/navigation/elements/DevelopFileMenu'
import { useEditor } from '../editor/editorContext'
import { buildDefaultCurves } from '../editor/curves'
import { createCopiedDevelop, serializeDevelopFile } from '../editor/developClipboard'
import { buildInitialAdjustments } from '../editor/editorReducer'

vi.mock('../editor/decodeImage', () => ({
  decodeImage: vi.fn(async () => ({
    bitmap: { width: 300, height: 200, close: () => undefined },
    metadata: null,
    source: 'developed' as const,
    noise: null,
    histogram: null,
  })),
}))

function developFile(exposure = 0.7): string {
  return serializeDevelopFile(
    createCopiedDevelop(
      { ...buildInitialAdjustments(), exposure },
      buildDefaultCurves(),
      null,
    ),
    '1.0.0',
  )
}

function Harness() {
  const { loadImage, image, adjustments } = useEditor()

  return (
    <>
      <button onClick={() => { void loadImage(new File([], 'photo.jpg')) }}>load</button>
      <DevelopFileMenu />
      <output data-testid="image">{image?.fileName ?? ''}</output>
      <output data-testid="exposure">{adjustments.exposure}</output>
    </>
  )
}

async function openPhoto(): Promise<void> {
  render(<Harness />)
  await userEvent.click(screen.getByRole('button', { name: 'load' }))
  await waitFor(() => expect(screen.getByTestId('image')).toHaveTextContent('photo.jpg'))
}

function importFile(contents: string): void {
  fireEvent.change(screen.getByLabelText('Import settings'), {
    target: { files: [new File([contents], 'look.json', { type: 'application/json' })] },
  })
}

describe('DevelopFileMenu', () => {
  it('asks for confirmation before replacing the develop', async () => {
    await openPhoto()

    importFile(developFile())

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('exposure')).toHaveTextContent('0')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('exposure')).toHaveTextContent('0')
  })

  it('applies the imported develop after confirmation', async () => {
    await openPhoto()

    importFile(developFile())
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(screen.getByTestId('exposure')).toHaveTextContent('0.7'))
  })

  it('reports an invalid file without opening the confirmation', async () => {
    await openPhoto()

    importFile('{ not json')

    expect(await screen.findByText('This file is not a valid CosmicLights settings file.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Import settings' })).not.toBeInTheDocument()
    expect(screen.getByTestId('exposure')).toHaveTextContent('0')
  })
})
