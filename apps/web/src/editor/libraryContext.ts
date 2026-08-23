import { createContext, use } from 'react'
import type { Library, PhotoId, StackId } from './library'

/**
 * Fields decoded from a photo's pixels that arrive after registration — what
 * the editor (or an enrichment pass) learned once a decode actually ran.
 */
export interface DecodedPhotoPatch {
  /** Grid thumbnail as a data URL, or `null` to keep whatever is stored. */
  thumbUrl?: string | null
  /** Capture time in epoch milliseconds, or `null` to keep what is stored. */
  captureTime?: number | null
}

/**
 * The library store: the pure model wrapped in React state, plus the runtime
 * file handles the model deliberately knows nothing about.
 *
 * Lives outside the editor store on purpose — regrouping photos must never be
 * undoable with Ctrl+Z, and the grid renders from this alone.
 */
export interface LibraryStore {
  /** The live library state. */
  library: Library
  /**
   * Registers files as photos immediately (so the grid appears at once) and
   * enriches each in the background with thumbnail and capture time.
   */
  importFiles: (files: File[]) => void
  /**
   * Attaches post-decode fields to the first photo registered under
   * `fileName`. No-op when no such photo exists.
   */
  attachDecodedPhoto: (fileName: string, patch: DecodedPhotoPatch) => void
  /** Groups photos into a new collapsed stack; moves them out of old ones. */
  stackPhotos: (photoIds: PhotoId[]) => void
  /** Appends photos to a stack. Members already inside are ignored. */
  appendToStack: (stackId: StackId, photoIds: PhotoId[]) => void
  /** Takes one photo out of its stack; keeps it in the library. */
  unstackPhoto: (photoId: PhotoId) => void
  /** Dissolves a stack; every member becomes unstacked. */
  dissolveStack: (stackId: StackId) => void
  /** Collapses or expands one stack. */
  toggleCollapsed: (stackId: StackId) => void
  /** Moves a member to another position within its stack. */
  reorderPhoto: (stackId: StackId, photoId: PhotoId, index: number) => void
  /** Chooses which member represents a collapsed stack. */
  setKeyPhoto: (stackId: StackId, photoId: PhotoId) => void
  /**
   * Stacks bursts/brackets automatically, clustering photos whose capture
   * times are within `maxGapMs` of each other.
   */
  autoStack: (maxGapMs?: number) => void
  /**
   * The imported file behind a photo, or `null` when unknown. Runtime handle,
   * kept out of the model so the library stays serialisable.
   */
  getFile: (photoId: PhotoId) => File | null
}

export const LibraryContext = createContext<LibraryStore | null>(null)

/**
 * Accesses the library store. Must be called inside a `LibraryProvider`.
 *
 * @throws if used outside of a `LibraryProvider`.
 */
export function useLibrary(): LibraryStore {
  const context = use(LibraryContext)
  if (context === null) {
    throw new Error('useLibrary must be used within a LibraryProvider')
  }
  return context
}
