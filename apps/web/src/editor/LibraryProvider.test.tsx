import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LibraryProvider } from './LibraryProvider'
import { useLibrary } from './libraryContext'

const file = (name: string) => new File([name], name)

describe('LibraryProvider', () => {
  const setup = (initialFiles?: File[]) =>
    renderHook(() => useLibrary(), {
      wrapper: ({ children }) => (
        <LibraryProvider initialFiles={initialFiles}>{children}</LibraryProvider>
      ),
    })

  it('starts empty', () => {
    const { result } = setup()
    expect(result.current.library.photos.size).toBe(0)
    expect(result.current.library.stacks.size).toBe(0)
  })

  it('registers imported files immediately and keeps their handles', async () => {
    const files = [file('a.jpg'), file('b.jpg')]
    const { result } = setup()

    act(() => result.current.importFiles(files))

    expect([...result.current.library.photos.values()].map(p => p.fileName)).toEqual([
      'a.jpg',
      'b.jpg',
    ])
    const [first] = [...result.current.library.photos.values()]
    expect(first !== undefined && result.current.getFile(first.id)).toBe(files[0])
  })

  it('ignores an empty import', () => {
    const { result } = setup()
    act(() => result.current.importFiles([]))
    expect(result.current.library.photos.size).toBe(0)
  })

  it('fills in enrichment when the async reads land', async () => {
    // jsdom yields no thumbnail and no EXIF: the enrichment resolves to nulls
    // without breaking anything — placeholders stay placeholders.
    const { result } = setup([file('a.jpg')])
    const [photo] = [...result.current.library.photos.values()]

    await waitFor(() => {
      expect(photo !== undefined && result.current.library.photos.get(photo.id)?.thumbUrl).toBeNull()
    })
  })

  it('seeds files on mount through initialFiles', async () => {
    const { result } = setup([file('seed.jpg')])
    await waitFor(() => expect(result.current.library.photos.size).toBe(1))
  })

  it('attaches decoded fields to the photo matching the file name', async () => {
    const { result } = setup([file('a.jpg'), file('b.jpg')])

    act(() =>
      result.current.attachDecodedPhoto('b.jpg', { thumbUrl: 'data:image/jpeg;b', captureTime: 42 }),
    )

    const byName = new Map(
      [...result.current.library.photos.values()].map(p => [p.fileName, p]),
    )
    expect(byName.get('a.jpg')?.captureTime).toBeNull()
    expect(byName.get('b.jpg')).toMatchObject({ thumbUrl: 'data:image/jpeg;b', captureTime: 42 })
  })

  it('keeps existing values when a patch carries nulls', async () => {
    const { result } = setup([file('a.jpg')])
    const [photo] = [...result.current.library.photos.values()]
    if (photo === undefined) throw new Error('expected a seeded photo')

    act(() => result.current.attachDecodedPhoto('a.jpg', { captureTime: 7 }))
    act(() =>
      result.current.attachDecodedPhoto('a.jpg', { thumbUrl: null, captureTime: null }),
    )

    expect(result.current.library.photos.get(photo.id)).toMatchObject({ captureTime: 7 })
  })

  it('stacks, toggles and unstacks through the pure model', () => {
    const { result } = setup()
    act(() => result.current.importFiles([file('a.jpg'), file('b.jpg')]))
    // Read the ids after the update lands — result.current inside the same
    // act() still holds the previous state.
    const ids = [...result.current.library.photos.values()].map(p => p.id)

    act(() => result.current.stackPhotos(ids))
    expect(result.current.library.stacks.size).toBe(1)

    const [stackId] = [...result.current.library.stacks.keys()]
    if (stackId === undefined) throw new Error('expected a stack')

    act(() => result.current.toggleCollapsed(stackId))
    expect(result.current.library.stacks.get(stackId)?.collapsed).toBe(false)

    act(() => result.current.unstackPhoto(ids[0]))
    expect(result.current.library.stacks.size).toBe(0)
  })

  it('auto-stacks bursts by capture time', () => {
    const { result } = setup()
    act(() => {
      result.current.importFiles([file('1.jpg'), file('2.jpg'), file('3.jpg')])
    })
    // Times are attached per file name: 1+2 form a burst, 3 is far away.
    const names = [...result.current.library.photos.values()].map(p => p.fileName)
    act(() => {
      result.current.attachDecodedPhoto(names[0], { captureTime: 0 })
      result.current.attachDecodedPhoto(names[1], { captureTime: 100 })
      result.current.attachDecodedPhoto(names[2], { captureTime: 999_999 })
    })

    act(() => result.current.autoStack())

    expect(result.current.library.stacks.size).toBe(1)
    const stack = [...result.current.library.stacks.values()][0]
    expect(stack?.photoIds).toHaveLength(2)
  })

  it('logs and ignores invalid operations instead of crashing', () => {
    const { result } = setup()
    act(() => result.current.stackPhotos(['missing']))
    expect(result.current.library.photos.size).toBe(0)
  })
})
