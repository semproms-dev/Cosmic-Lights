import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryStrip } from './LibraryStrip'
import { LibraryProvider } from '../../editor/LibraryProvider'
import { addPhotos, createLibrary, createStack } from '../../editor/library'
import type { Library } from '../../editor/library'

// The strip reads the editor only to decide whether opening needs a discard
// confirmation; a stub keeps the heavy editor store out of these tests.
const mocks = vi.hoisted(() => ({
  loadImage: vi.fn(),
  imageDirty: false,
}))

vi.mock('../../editor/editorContext', () => ({
  useEditor: () => ({ imageDirty: mocks.imageDirty, loadImage: mocks.loadImage }),
}))

const file = (name: string) => new File([name], name)

/** A library pre-seeded with three photos and one collapsed pair. */
function seededLibrary(): Library {
  const photo = (id: string, fileName: string) => ({
    id,
    fileName,
    thumbUrl: null,
    captureTime: null,
  })
  const library = addPhotos(createLibrary(), [
    photo('a', 'alpha.jpg'),
    photo('b', 'beta.jpg'),
    photo('c', 'gamma.jpg'),
  ])
  return createStack(library, ['a', 'b'])
}

function renderStrip(props: { library?: Library; files?: File[] } = {}) {
  return render(
    <MantineProvider defaultColorScheme="dark">
      <LibraryProvider initialLibrary={props.library} initialFiles={props.files}>
        <LibraryStrip />
      </LibraryProvider>
    </MantineProvider>,
  )
}

beforeEach(() => {
  mocks.loadImage.mockReset()
  mocks.imageDirty = false
})

describe('LibraryStrip', () => {
  it('renders collapsed by default, showing only the header', () => {
    renderStrip({ library: seededLibrary() })
    expect(screen.getByText('library.title')).toBeInTheDocument()
    expect(screen.queryByText('alpha.jpg')).not.toBeInTheDocument()
  })

  it('lists photos once expanded', async () => {
    renderStrip({ library: seededLibrary() })
    fireEvent.click(screen.getByText('library.title'))
    expect(await screen.findByText('gamma.jpg')).toBeInTheDocument()
  })

  it('shows a collapsed stack as one item with a member count', () => {
    renderStrip({ library: seededLibrary() })
    fireEvent.click(screen.getByText('library.title'))
    expect(screen.getByText('2')).toBeInTheDocument()
    // The key photo stands in for the group; its covered member does not show.
    expect(screen.getByText('alpha.jpg')).toBeInTheDocument()
    expect(screen.queryByText('beta.jpg')).not.toBeInTheDocument()
    expect(screen.getByText('gamma.jpg')).toBeInTheDocument()
  })

  it('selects exclusively on click and adds on ctrl-click', async () => {
    const files = [file('one.jpg'), file('two.jpg'), file('three.jpg')]
    renderStrip({ files })
    fireEvent.click(screen.getByText('library.title'))
    await screen.findByText('one.jpg')

    fireEvent.click(screen.getByText('one.jpg'))
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(1)

    fireEvent.click(screen.getByText('two.jpg'), { ctrlKey: true })
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(2)
  })

  it('enables stacking at two selected and collapses them into a badge', async () => {
    const files = [file('one.jpg'), file('two.jpg')]
    renderStrip({ files })
    fireEvent.click(screen.getByText('library.title'))
    await screen.findByText('one.jpg')

    const stackButton = screen.getByRole('button', { name: 'library.stack' })
    expect(stackButton).toBeDisabled()

    fireEvent.click(screen.getByText('one.jpg'))
    fireEvent.click(screen.getByText('two.jpg'), { ctrlKey: true })
    expect(stackButton).toBeEnabled()

    fireEvent.click(stackButton)
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
  })

  it('unstacks every selected member', () => {
    renderStrip({ library: seededLibrary() })
    fireEvent.click(screen.getByText('library.title'))

    // Clicking the collapsed stack selects all of its members.
    fireEvent.click(screen.getByText('2'))
    fireEvent.click(screen.getByRole('button', { name: 'library.unstack' }))

    expect(screen.getByText('alpha.jpg')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()
  })

  it('opens a photo in the editor on double-click', async () => {
    const one = file('one.jpg')
    renderStrip({ files: [one, file('two.jpg')] })
    fireEvent.click(screen.getByText('library.title'))
    await screen.findByText('one.jpg')

    fireEvent.doubleClick(screen.getByText('one.jpg'))
    expect(mocks.loadImage).toHaveBeenCalledWith(one)
  })

  it('asks before replacing dirty edits, then opens on confirm', async () => {
    mocks.imageDirty = true
    const one = file('one.jpg')
    renderStrip({ files: [one] })
    fireEvent.click(screen.getByText('library.title'))
    await screen.findByText('one.jpg')

    fireEvent.doubleClick(screen.getByText('one.jpg'))
    expect(mocks.loadImage).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'confirm.discard' }))
    expect(mocks.loadImage).toHaveBeenCalledWith(one)
  })

  it('leaves the edit alone when the discard dialog is cancelled', async () => {
    mocks.imageDirty = true
    renderStrip({ files: [file('one.jpg')] })
    fireEvent.click(screen.getByText('library.title'))
    await screen.findByText('one.jpg')

    fireEvent.doubleClick(screen.getByText('one.jpg'))
    fireEvent.click(await screen.findByRole('button', { name: 'confirm.cancel' }))
    expect(mocks.loadImage).not.toHaveBeenCalled()
  })
})
