import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { logger } from '../logger'
import { autoStackGroups } from './autoStack'
import {
  addPhotos,
  addToStack,
  createLibrary,
  createStack,
  removeFromStack,
  reorderInStack,
  setKeyPhoto,
  toggleCollapsed,
  unstackAll,
  updatePhoto,
} from './library'
import type { Library, PhotoId } from './library'
import { LibraryContext } from './libraryContext'
import type { DecodedPhotoPatch, LibraryStore } from './libraryContext'
import { createPhoto, enrichPhoto } from './photoImport'

/**
 * Everything the provider owns in one immutable snapshot: the model state plus
 * the runtime `File` handles the model deliberately knows nothing about.
 *
 * Keeping the handles here (rather than in a ref) lets mount-time seeding be a
 * plain lazy initialiser instead of an effect — photos and their handles are
 * always built together or not at all.
 */
interface ProviderState {
  library: Library
  files: Map<PhotoId, File>
}

/** Builds the initial snapshot: existing state, optionally grown by files. */
function buildState(seedLibrary: Library | undefined, seedFiles: File[] | undefined): ProviderState {
  const base = seedLibrary ?? createLibrary()
  if (seedFiles === undefined || seedFiles.length === 0) {
    return { library: base, files: new Map() }
  }
  const photos = seedFiles.map(createPhoto)
  const files = new Map<PhotoId, File>()
  for (const [index, photo] of photos.entries()) {
    files.set(photo.id, seedFiles[index])
  }
  return { library: addPhotos(base, photos), files }
}

interface LibraryProviderProps {
  children: ReactNode
  /** Overrides the initial state, mainly for tests. Defaults to empty. */
  initialLibrary?: Library
  /**
   * Files imported as soon as the provider mounts — the programmatic way to
   * seed a library with real file handles (tests, demo data).
   */
  initialFiles?: File[]
}

/**
 * Provides the {@link LibraryStore} to the component tree.
 *
 * Every mutation goes through the pure model in `library.ts`; this component
 * only owns React state and the `File` handles. Invalid operations (a stale id
 * after an undo-less regroup, say) are logged and ignored rather than thrown:
 * the grid must never crash over bookkeeping.
 */
export function LibraryProvider({ children, initialLibrary, initialFiles }: LibraryProviderProps) {
  const [state, setState] = useState<ProviderState>(() =>
    buildState(initialLibrary, initialFiles),
  )

  /** Applies a model update; failures log and leave the state untouched. */
  const run = useCallback((update: (current: Library) => Library) => {
    setState(current => {
      try {
        return { ...current, library: update(current.library) }
      } catch (error) {
        logger.error('library update failed', error)
        return current
      }
    })
  }, [])

  const importFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const photos = files.map(createPhoto)
      setState(current => {
        const handles = new Map(current.files)
        for (const [index, photo] of photos.entries()) {
          handles.set(photo.id, files[index])
        }
        try {
          return { files: handles, library: addPhotos(current.library, photos) }
        } catch (error) {
          logger.error('library import failed', error)
          return current
        }
      })
      // Enrichment lands per photo whenever its decode finishes; failures
      // resolve to nulls and simply leave placeholders in the grid.
      for (const [index, photo] of photos.entries()) {
        void enrichPhoto(files[index]).then(patch => {
          run(current => updatePhoto(current, photo.id, patch))
        })
      }
    },
    [run],
  )

  const attachDecodedPhoto = useCallback(
    (fileName: string, patch: DecodedPhotoPatch) => {
      run(current => {
        for (const photo of current.photos.values()) {
          if (photo.fileName === fileName) return updatePhoto(current, photo.id, patch)
        }
        logger.debug(`no library photo named ${fileName} to attach decoded fields to`)
        return current
      })
    },
    [run],
  )

  const stackPhotos = useCallback(
    (photoIds: PhotoId[]) => run(c => createStack(c, photoIds)),
    [run],
  )
  const appendToStack = useCallback(
    (stackId: string, photoIds: PhotoId[]) => run(c => addToStack(c, stackId, photoIds)),
    [run],
  )
  const unstackPhoto = useCallback(
    (photoId: PhotoId) => run(c => removeFromStack(c, photoId)),
    [run],
  )
  const dissolveStack = useCallback(
    (stackId: string) => run(c => unstackAll(c, stackId)),
    [run],
  )
  const collapseToggle = useCallback(
    (stackId: string) => run(c => toggleCollapsed(c, stackId)),
    [run],
  )
  const reorderPhoto = useCallback(
    (stackId: string, photoId: PhotoId, index: number) =>
      run(c => reorderInStack(c, stackId, photoId, index)),
    [run],
  )
  const changeKeyPhoto = useCallback(
    (stackId: string, photoId: PhotoId) => run(c => setKeyPhoto(c, stackId, photoId)),
    [run],
  )
  const autoStack = useCallback(
    (maxGapMs?: number) =>
      run(current => {
        let next = current
        for (const group of autoStackGroups([...current.photos.values()], maxGapMs)) {
          next = createStack(next, group)
        }
        return next
      }),
    [run],
  )

  const store = useMemo<LibraryStore>(
    () => ({
      library: state.library,
      importFiles,
      attachDecodedPhoto,
      stackPhotos,
      appendToStack,
      unstackPhoto,
      dissolveStack,
      toggleCollapsed: collapseToggle,
      reorderPhoto,
      setKeyPhoto: changeKeyPhoto,
      autoStack,
      getFile: photoId => state.files.get(photoId) ?? null,
    }),
    [
      state,
      importFiles,
      attachDecodedPhoto,
      stackPhotos,
      appendToStack,
      unstackPhoto,
      dissolveStack,
      collapseToggle,
      reorderPhoto,
      changeKeyPhoto,
      autoStack,
    ],
  )

  return <LibraryContext value={store}>{children}</LibraryContext>
}
