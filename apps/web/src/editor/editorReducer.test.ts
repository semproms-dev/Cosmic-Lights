import { describe, expect, it } from 'vitest'
import { buildDefaultCurves } from './curves'
import type { LoadedImage } from './image'
import {
  buildInitialAdjustments,
  editorReducer,
  type EditorStoreState,
} from './editorReducer'

/** Builds a fresh store state, letting a test override individual slices. */
const createState = (overrides: Partial<EditorStoreState> = {}): EditorStoreState => ({
  adjustments: buildInitialAdjustments(),
  curves: buildDefaultCurves(),
  image: null,
  imageStatus: 'idle',
  imageDirty: false,
  ...overrides,
})

/** A decoded-image stand-in; the reducer never touches the bitmap/metadata fields. */
const fakeImage = {
  bitmap: {},
  width: 100,
  height: 80,
  fileName: 'test.arw',
  metadata: {},
} as unknown as LoadedImage

describe('editorReducer — image slice', () => {
  it('SET_IMAGE_STATUS updates the status and leaves the image untouched', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_IMAGE_STATUS', status: 'loading' })

    expect(next.imageStatus).toBe('loading')
    expect(next.image).toBeNull()
  })

  it('SET_IMAGE stores the image, forces the status back to idle and clears the dirty flag', () => {
    const state = createState({ imageStatus: 'loading', imageDirty: true })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.image).toBe(fakeImage)
    expect(next.imageStatus).toBe('idle')
    expect(next.imageDirty).toBe(false)
  })

  it('SET marks the image dirty; RESET_ADJUSTEMENTS clears it again', () => {
    const dirtied = editorReducer(createState(), { type: 'SET', key: 'exposure', value: 1 })
    expect(dirtied.imageDirty).toBe(true)

    const reset = editorReducer(dirtied, { type: 'RESET_ADJUSTEMENTS' })
    expect(reset.imageDirty).toBe(false)
  })

  it('CLEAR_IMAGE drops the image', () => {
    const state = createState({ image: fakeImage })

    const next = editorReducer(state, { type: 'CLEAR_IMAGE' })

    expect(next.image).toBeNull()
  })

  it('does not mutate the previous state', () => {
    const state = createState()

    editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(state.image).toBeNull()
    expect(state.imageStatus).toBe('idle')
  })

  it('leaves the adjustments and curves slices referentially untouched', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.adjustments).toBe(state.adjustments)
    expect(next.curves).toBe(state.curves)
  })
})
