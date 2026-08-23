/**
 * Library data model: the photos the user has imported this session and the
 * Lightroom-style stacks that group them.
 *
 * Pure module on purpose — every operation takes a {@link Library} and returns
 * a new one, so the provider can hold it in React state and nothing here needs
 * the editor store. The library deliberately lives **outside** undo history:
 * Ctrl+Z undoes an edit, not a regroup.
 *
 * Two invariants hold after every operation and every function may rely on
 * them:
 *
 * 1. A photo belongs to **at most one** stack. Operations that would violate
 *    this detach the photo from its previous stack first (the Lightroom
 *    "move to stack" behaviour) instead of rejecting the move.
 * 2. A stack never holds fewer than **two** photos. Any operation that leaves
 *    a stack with one dissolves it, so no caller ever checks for degenerate
 *    stacks.
 */

import { createId } from './createId'

/** Identifies a {@link Photo} within the library. */
export type PhotoId = string

/** Identifies a {@link Stack} within the library. */
export type StackId = string

/** One imported photo. Holds references, never decoded pixels. */
export interface Photo {
  id: PhotoId
  /** Original file name, shown under the thumbnail and in tooltips. */
  fileName: string
  /**
   * Small preview generated once at import, or `null` until then. The grid
   * renders this; the full bitmap is only decoded when the photo is opened in
   * the editor.
   */
  thumbUrl: string | null
  /** EXIF capture time in epoch milliseconds, or `null` if the file has none. */
  captureTime: number | null
}

/** An ordered group of photos that collapses into one grid item. */
export interface Stack {
  id: StackId
  /** Members in display order — `photoIds[0]` is the top of the stack. */
  photoIds: PhotoId[]
  /** The member shown as the collapsed thumbnail. Always ∈ `photoIds`. */
  keyPhotoId: PhotoId
  /** Whether the grid shows one item for the whole stack or each member. */
  collapsed: boolean
}

/** The whole collection: photos plus their grouping. */
export interface Library {
  photos: Map<PhotoId, Photo>
  stacks: Map<StackId, Stack>
}

/**
 * One entry of the grid, tagged so the component can render a single photo or
 * a collapsed stack (badge, expand affordance) without re-querying anything.
 */
export type LibraryItem =
  | { kind: 'photo'; photo: Photo }
  | { kind: 'stack'; stack: Stack }

/**
 * An empty library — the provider's initial state.
 *
 * @returns A fresh {@link Library} with no photos and no stacks.
 */
export function createLibrary(): Library {
  return { photos: new Map(), stacks: new Map() }
}

/**
 * Registers photos with the library.
 *
 * Idempotent on id: a photo whose id is already registered is skipped, so
 * re-importing the same selection (or dropping the same file twice) neither
 * duplicates entries nor resets their thumbnails.
 *
 * @param library - The library to extend.
 * @param photos - The photos to register, in display order.
 * @returns A new {@link Library}; the input is never mutated.
 */
export function addPhotos(library: Library, photos: Photo[]): Library {
  const next = new Map(library.photos)
  for (const photo of photos) {
    if (!next.has(photo.id)) next.set(photo.id, photo)
  }
  return { ...library, photos: next }
}

/**
 * The enrichment fields a photo gains after registration. Identity fields
 * (`id`, `fileName`) are deliberately absent: they never change.
 */
export type PhotoPatch = Partial<Pick<Photo, 'thumbUrl' | 'captureTime'>>

/**
 * Patches the mutable fields of one photo — the async fills (thumbnail,
 * capture time) that land after registration.
 *
 * A patch value of `null` is ignored rather than written: an enrichment pass
 * that found nothing must not erase what an earlier pass already stored.
 *
 * @param library - The library to modify.
 * @param photoId - The photo to update.
 * @param patch - The fields to set; unlisted fields keep their value.
 * @returns A new {@link Library}, or the input unchanged when nothing was set.
 * @throws When the photo id is unknown.
 */
export function updatePhoto(library: Library, photoId: PhotoId, patch: PhotoPatch): Library {
  const photo = requirePhoto(library, photoId)
  const thumbUrl = patch.thumbUrl ?? photo.thumbUrl
  const captureTime = patch.captureTime ?? photo.captureTime
  if (thumbUrl === photo.thumbUrl && captureTime === photo.captureTime) return library

  const nextPhotos = new Map(library.photos)
  nextPhotos.set(photoId, { ...photo, thumbUrl, captureTime })
  return { ...library, photos: nextPhotos }
}

/**
 * Finds the stack that contains a photo, if any.
 *
 * Linear scan over the stacks — session-sized libraries make a reverse index
 * not worth the invalidation cost.
 *
 * @param library - The library to search.
 * @param photoId - The photo to look up.
 * @returns The owning {@link Stack}, or `null` when the photo is unstacked.
 */
export function stackOf(library: Library, photoId: PhotoId): Stack | null {
  for (const stack of library.stacks.values()) {
    if (stack.photoIds.includes(photoId)) return stack
  }
  return null
}

/**
 * Flattens the library into what the grid renders, in insertion order.
 *
 * Unstacked photos appear as themselves. A collapsed stack appears exactly
 * once — at the position of its key photo. An expanded stack contributes each
 * member individually, so expanding happens in place.
 *
 * @param library - The library to flatten.
 * @returns The visible items, in a stable order.
 */
export function visibleItems(library: Library): LibraryItem[] {
  const items: LibraryItem[] = []
  for (const photo of library.photos.values()) {
    const stack = stackOf(library, photo.id)
    if (stack === null || !stack.collapsed) {
      items.push({ kind: 'photo', photo })
      continue
    }
    // Collapsed: only the key photo stands in for the whole stack; its
    // position in the grid is the key photo's own position.
    if (photo.id === stack.keyPhotoId) items.push({ kind: 'stack', stack })
  }
  return items
}

/**
 * Groups photos into a new collapsed stack.
 *
 * Photos already in another stack are moved out of it first; stacks left with
 * a single photo dissolve along the way. The first id given becomes the key
 * photo.
 *
 * @param library - The library to modify.
 * @param photoIds - The photos to group, top of the stack first. Must name at
 *   least two distinct registered photos.
 * @returns A new {@link Library} with the extra stack.
 * @throws When any id is unknown or fewer than two distinct photos are given.
 */
export function createStack(library: Library, photoIds: PhotoId[]): Library {
  const unique = [...new Set(photoIds)]
  if (unique.length < 2) {
    throw new Error('A stack needs at least two distinct photos')
  }
  for (const id of unique) requirePhoto(library, id)

  let stacks = library.stacks
  for (const id of unique) stacks = detachFromStacks(stacks, id)

  const stack: Stack = {
    id: createId(),
    photoIds: unique,
    keyPhotoId: unique[0],
    collapsed: true,
  }
  const nextStacks = new Map(stacks)
  nextStacks.set(stack.id, stack)
  return { ...library, stacks: nextStacks }
}

/**
 * Appends photos to an existing stack, in the order given.
 *
 * Photos already in the target are ignored rather than moved to the end —
 * adding a member twice must not reorder the stack, and skipping them also
 * guarantees the detach pass below cannot touch (and possibly dissolve) the
 * target itself.
 *
 * @param library - The library to modify.
 * @param stackId - The stack to grow.
 * @param photoIds - The photos to append. May be empty.
 * @returns A new {@link Library}, or the input unchanged when nothing was added.
 * @throws When the stack or any photo id is unknown.
 */
export function addToStack(library: Library, stackId: StackId, photoIds: PhotoId[]): Library {
  const stack = requireStack(library, stackId)
  const unique = [...new Set(photoIds)]
  for (const id of unique) requirePhoto(library, id)

  const incoming = unique.filter(id => !stack.photoIds.includes(id))
  if (incoming.length === 0) return library

  let stacks = library.stacks
  for (const id of incoming) stacks = detachFromStacks(stacks, id)

  // `incoming` excludes the target's members, so the detach pass above left
  // the target untouched — it is still reachable under the same id.
  const target = stacks.get(stackId) ?? stack
  const nextStacks = new Map(stacks)
  nextStacks.set(stackId, { ...target, photoIds: [...target.photoIds, ...incoming] })
  return { ...library, stacks: nextStacks }
}

/**
 * Takes one photo out of whatever stack holds it. The photo stays in the
 * library; only its membership ends. Removing down to one member dissolves
 * the stack, per the model invariant.
 *
 * @param library - The library to modify.
 * @param photoId - The photo to unstack.
 * @returns A new {@link Library}, or the input unchanged when the photo was
 *   already unstacked.
 * @throws When the photo id is unknown.
 */
export function removeFromStack(library: Library, photoId: PhotoId): Library {
  requirePhoto(library, photoId)
  const stacks = detachFromStacks(library.stacks, photoId)
  if (stacks === library.stacks) return library
  return { ...library, stacks }
}

/**
 * Dissolves a stack outright; every member becomes unstacked.
 *
 * @param library - The library to modify.
 * @param stackId - The stack to remove.
 * @returns A new {@link Library}.
 * @throws When the stack id is unknown.
 */
export function unstackAll(library: Library, stackId: StackId): Library {
  requireStack(library, stackId)
  const nextStacks = new Map(library.stacks)
  nextStacks.delete(stackId)
  return { ...library, stacks: nextStacks }
}

/**
 * Collapses an expanded stack or expands a collapsed one.
 *
 * @param library - The library to modify.
 * @param stackId - The stack to toggle.
 * @returns A new {@link Library}.
 * @throws When the stack id is unknown.
 */
export function toggleCollapsed(library: Library, stackId: StackId): Library {
  const stack = requireStack(library, stackId)
  const nextStacks = new Map(library.stacks)
  nextStacks.set(stackId, { ...stack, collapsed: !stack.collapsed })
  return { ...library, stacks: nextStacks }
}

/**
 * Moves a photo to another position within its stack.
 *
 * `newIndex` is clamped into range rather than rejected, so drag handlers can
 * pass raw drop positions. Reordering to the current index changes nothing.
 *
 * @param library - The library to modify.
 * @param stackId - The stack to reorder.
 * @param photoId - The photo to move; must already be a member.
 * @param newIndex - Desired position, clamped to `[0, size - 1]`.
 * @returns A new {@link Library}, or the input unchanged when the move is a
 *   no-op.
 * @throws When the stack is unknown or the photo is not one of its members.
 */
export function reorderInStack(
  library: Library,
  stackId: StackId,
  photoId: PhotoId,
  newIndex: number,
): Library {
  const stack = requireStack(library, stackId)
  const currentIndex = stack.photoIds.indexOf(photoId)
  if (currentIndex === -1) {
    throw new Error(`Photo ${photoId} is not in stack ${stackId}`)
  }
  const index = Math.min(Math.max(newIndex, 0), stack.photoIds.length - 1)
  if (index === currentIndex) return library

  const photoIds = [...stack.photoIds]
  photoIds.splice(currentIndex, 1)
  photoIds.splice(index, 0, photoId)

  const nextStacks = new Map(library.stacks)
  nextStacks.set(stackId, { ...stack, photoIds })
  return { ...library, stacks: nextStacks }
}

/**
 * Chooses which member represents a collapsed stack in the grid.
 *
 * @param library - The library to modify.
 * @param stackId - The stack whose key photo changes.
 * @param photoId - The new key photo; must already be a member.
 * @returns A new {@link Library}, or the input unchanged when the photo is
 *   already the key.
 * @throws When the stack is unknown or the photo is not one of its members.
 */
export function setKeyPhoto(library: Library, stackId: StackId, photoId: PhotoId): Library {
  const stack = requireStack(library, stackId)
  if (!stack.photoIds.includes(photoId)) {
    throw new Error(`Photo ${photoId} is not in stack ${stackId}`)
  }
  if (stack.keyPhotoId === photoId) return library

  const nextStacks = new Map(library.stacks)
  nextStacks.set(stackId, { ...stack, keyPhotoId: photoId })
  return { ...library, stacks: nextStacks }
}

/**
 * Copies the stacks map minus one photo's membership, honouring both
 * invariants: the photo is removed from whichever stack holds it, key-photo
 * duty falls to the new first member, and a stack left with a single photo is
 * deleted outright.
 *
 * Copy-on-write: returns the input map untouched (same reference) when the
 * photo is in no stack, which lets callers detect no-ops cheaply.
 */
function detachFromStacks(
  stacks: Map<StackId, Stack>,
  photoId: PhotoId,
): Map<StackId, Stack> {
  let next: Map<StackId, Stack> | null = null
  for (const [id, stack] of stacks) {
    if (!stack.photoIds.includes(photoId)) continue
    if (next === null) next = new Map(stacks)

    const remaining = stack.photoIds.filter(member => member !== photoId)
    if (remaining.length <= 1) {
      // Invariant 2: one member left is not a stack any more — free it.
      next.delete(id)
      continue
    }
    next.set(id, {
      ...stack,
      photoIds: remaining,
      // Invariant: keyPhotoId ∈ photoIds. Losing the cover promotes the top.
      keyPhotoId: stack.keyPhotoId === photoId ? remaining[0] : stack.keyPhotoId,
    })
  }
  return next ?? stacks
}

/** Fetches a photo or fails loudly — callers never guard against typos. */
function requirePhoto(library: Library, photoId: PhotoId): Photo {
  const photo = library.photos.get(photoId)
  if (photo === undefined) throw new Error(`Unknown photo: ${photoId}`)
  return photo
}

/** Fetches a stack or fails loudly — same contract as {@link requirePhoto}. */
function requireStack(library: Library, stackId: StackId): Stack {
  const stack = library.stacks.get(stackId)
  if (stack === undefined) throw new Error(`Unknown stack: ${stackId}`)
  return stack
}
