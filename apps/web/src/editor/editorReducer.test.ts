import { describe, expect, it } from 'vitest'
import { effectsAdjustement } from './adjustments'
import { buildDefaultCurves } from './curves'
import type { CropRegion, LoadedImage } from './image'
import {
  buildInitialAdjustments,
  editorReducer,
  type EditorStoreState,
} from './editorReducer'
import { createMask, MAX_MASKS, type BrushStroke, type Mask } from './masks'
import type { Preset } from './presets'
import { IDENTITY_ORIENTATION } from './rotation'

/** Builds a fresh store state, letting a test override individual slices. */
const createState = (overrides: Partial<EditorStoreState> = {}): EditorStoreState => ({
  adjustments: buildInitialAdjustments(),
  curves: buildDefaultCurves(),
  image: null,
  imageStatus: 'idle',
  imageDirty: false,
  cropRegion: null,
  cropRatio: 'Original',
  resetDialogOpen: false,
  masks: [],
  activeMaskId: null,
  orientation: IDENTITY_ORIENTATION,
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

/** A sample crop region in image pixels. */
const fakeRegion: CropRegion = { x: 10, y: 20, width: 40, height: 30 }

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

  it('SET_IMAGE resets adjustments and curves to their defaults', () => {
    const state = createState({
      adjustments: { ...buildInitialAdjustments(), exposure: 5 },
      curves: {
        ...buildDefaultCurves(),
        rgb: [
          { x: 0, y: 0 },
          { x: 128, y: 200 },
          { x: 255, y: 255 },
        ],
      },
    })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.adjustments).toEqual(buildInitialAdjustments())
    expect(next.curves).toEqual(buildDefaultCurves())
  })
})

describe('editorReducer — effects slice (vignette + grain)', () => {
  it('seeds every effects key, so none reaches the shader as NaN', () => {
    const adjustments = buildInitialAdjustments()

    for (const option of effectsAdjustement) {
      expect(adjustments[option.key]).toBe(option.defaultValue)
    }
  })

  it('starts neutral: no shading, midpoint and feather centred', () => {
    const adjustments = buildInitialAdjustments()

    expect(adjustments.vignette).toBe(0)
    expect(adjustments.vignetteMidpoint).toBe(50)
    expect(adjustments.vignetteFeather).toBe(50)
  })

  it('SET stores a negative amount (Lightroom sign: negative darkens)', () => {
    const next = editorReducer(createState(), { type: 'SET', key: 'vignette', value: -60 })

    expect(next.adjustments.vignette).toBe(-60)
    expect(next.imageDirty).toBe(true)
  })

  it('RESET_ADJUSTEMENTS returns the vignette to its defaults', () => {
    const state = createState({
      adjustments: { ...buildInitialAdjustments(), vignette: -60, vignetteMidpoint: 10 },
    })

    const next = editorReducer(state, { type: 'RESET_ADJUSTEMENTS' })

    expect(next.adjustments.vignette).toBe(0)
    expect(next.adjustments.vignetteMidpoint).toBe(50)
  })

  it('starts with the grain off but its size and roughness centred', () => {
    const adjustments = buildInitialAdjustments()

    expect(adjustments.grain).toBe(0)
    expect(adjustments.grainSize).toBe(50)
    expect(adjustments.grainRoughness).toBe(50)
  })

  it('SET stores the grain amount', () => {
    const next = editorReducer(createState(), { type: 'SET', key: 'grain', value: 35 })

    expect(next.adjustments.grain).toBe(35)
    expect(next.imageDirty).toBe(true)
  })

  it('RESET_ADJUSTEMENTS returns the grain to its defaults', () => {
    const state = createState({
      adjustments: { ...buildInitialAdjustments(), grain: 80, grainSize: 5, grainRoughness: 90 },
    })

    const next = editorReducer(state, { type: 'RESET_ADJUSTEMENTS' })

    expect(next.adjustments.grain).toBe(0)
    expect(next.adjustments.grainSize).toBe(50)
    expect(next.adjustments.grainRoughness).toBe(50)
  })
})

describe('editorReducer — presets', () => {
  /** A preset that touches two sliders and the master curve. */
  const preset: Preset = {
    id: 'test',
    name: 'Test',
    kind: 'style',
    adjustments: { contrast: 25, vignette: -20 },
    curves: { rgb: [{ x: 0, y: 0 }, { x: 128, y: 150 }, { x: 255, y: 255 }] },
  }

  it('APPLY_PRESET writes the preset values and its curve', () => {
    const next = editorReducer(createState(), { type: 'APPLY_PRESET', preset })

    expect(next.adjustments.contrast).toBe(25)
    expect(next.adjustments.vignette).toBe(-20)
    expect(next.curves.rgb).toEqual(preset.curves?.rgb)
    expect(next.imageDirty).toBe(true)
  })

  it('APPLY_PRESET resets the sliders the preset does not name', () => {
    // Otherwise the same preset would land differently depending on what was
    // set before, and the panel's thumbnail would be a lie.
    const state = createState({
      adjustments: { ...buildInitialAdjustments(), exposure: 2, saturation: 40 },
      curves: { ...buildDefaultCurves(), red: [{ x: 0, y: 40 }, { x: 255, y: 255 }] },
    })

    const next = editorReducer(state, { type: 'APPLY_PRESET', preset })

    expect(next.adjustments.exposure).toBe(0)
    expect(next.adjustments.saturation).toBe(0)
    expect(next.curves.red).toEqual(buildDefaultCurves().red)
  })

  it('APPLY_PRESET leaves crop, orientation and masks alone', () => {
    const mask = createMask('brush', 'Brush 1')
    const state = createState({
      cropRegion: fakeRegion,
      masks: [mask],
      activeMaskId: mask.id,
    })

    const next = editorReducer(state, { type: 'APPLY_PRESET', preset })

    expect(next.cropRegion).toEqual(fakeRegion)
    expect(next.masks).toEqual([mask])
    expect(next.activeMaskId).toBe(mask.id)
    expect(next.orientation).toEqual(IDENTITY_ORIENTATION)
  })
})

describe('editorReducer — crop slice', () => {
  it('SET_CROP stores the region and marks the image dirty', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_CROP', cropRegion: fakeRegion })

    expect(next.cropRegion).toEqual(fakeRegion)
    expect(next.imageDirty).toBe(true)
  })

  it('CLEAR_CROP resets the crop region to null', () => {
    const state = createState({ cropRegion: fakeRegion })

    const next = editorReducer(state, { type: 'CLEAR_CROP' })

    expect(next.cropRegion).toBeNull()
  })

  it('SET_IMAGE discards any active crop', () => {
    const state = createState({ cropRegion: fakeRegion })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.cropRegion).toBeNull()
  })

  it('does not mutate the previous state on SET_CROP', () => {
    const state = createState()

    editorReducer(state, { type: 'SET_CROP', cropRegion: fakeRegion })

    expect(state.cropRegion).toBeNull()
  })

  it('SET_CROP_RATIO stores the label without marking the image dirty', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'SET_CROP_RATIO', ratio: '16:9' })

    expect(next.cropRatio).toBe('16:9')
    expect(next.imageDirty).toBe(false)
  })

  it('SET_IMAGE resets the crop ratio to Original', () => {
    const state = createState({ cropRatio: '3:2' })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.cropRatio).toBe('Original')
  })

  it('SET_IMAGE resets the orientation, so a new photo does not inherit the turn', () => {
    const state = createState({ orientation: { quarterTurns: 3, flipH: true, flipV: false, angleDeg: 0 } })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.orientation).toEqual(IDENTITY_ORIENTATION)
  })
})

describe('editorReducer — orientation slice', () => {
  it('SET_ROTATION_ANGLE sets the free angle and leaves turns and mirrors alone', () => {
    const state = createState({ orientation: { quarterTurns: 1, flipH: true, flipV: false, angleDeg: 0 } })

    const next = editorReducer(state, { type: 'SET_ROTATION_ANGLE', angleDeg: -12.5 })

    expect(next.orientation).toEqual({ quarterTurns: 1, flipH: true, flipV: false, angleDeg: -12.5 })
    expect(next.imageDirty).toBe(true)
  })

  it('RESET_ORIENTATION puts the photo back upright, free angle included', () => {
    const state = createState({ orientation: { quarterTurns: 3, flipH: true, flipV: true, angleDeg: -12.5 } })

    const next = editorReducer(state, { type: 'RESET_ORIENTATION' })

    expect(next.orientation).toEqual(IDENTITY_ORIENTATION)
    expect(next.imageDirty).toBe(false)
  })
})

describe('editorReducer — reset dialog slice', () => {
  it('OPEN_RESET_DIALOG marks the dialog open', () => {
    const state = createState()

    const next = editorReducer(state, { type: 'OPEN_RESET_DIALOG' })

    expect(next.resetDialogOpen).toBe(true)
  })

  it('CLOSE_RESET_DIALOG marks the dialog closed', () => {
    const state = createState({ resetDialogOpen: true })

    const next = editorReducer(state, { type: 'CLOSE_RESET_DIALOG' })

    expect(next.resetDialogOpen).toBe(false)
  })
})

describe('editorReducer — masks', () => {
  const stroke: BrushStroke = {
    points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    radius: 20,
    hardness: 0.5,
    mode: 'add',
  }

  it('ADD_MASK appends the mask and selects it', () => {
    const mask = createMask('brush', 'Brush 1')

    const next = editorReducer(createState(), { type: 'ADD_MASK', mask })

    expect(next.masks).toEqual([mask])
    expect(next.activeMaskId).toBe(mask.id)
    expect(next.imageDirty).toBe(true)
  })

  it('ADD_MASK is a no-op once the cap is reached', () => {
    const masks: Mask[] = Array.from({ length: MAX_MASKS }, (_, i) =>
      createMask('brush', `Brush ${i + 1}`),
    )
    const state = createState({ masks })

    const next = editorReducer(state, { type: 'ADD_MASK', mask: createMask('sky', 'Sky 1') })

    expect(next).toBe(state)
  })

  it('REMOVE_MASK drops the mask and clears a dangling selection', () => {
    const mask = createMask('brush', 'Brush 1')
    const state = createState({ masks: [mask], activeMaskId: mask.id })

    const next = editorReducer(state, { type: 'REMOVE_MASK', id: mask.id })

    expect(next.masks).toEqual([])
    expect(next.activeMaskId).toBeNull()
  })

  it('REMOVE_MASK keeps the selection when another mask was active', () => {
    const a = createMask('brush', 'Brush 1')
    const b = createMask('sky', 'Sky 1')
    const state = createState({ masks: [a, b], activeMaskId: b.id })

    const next = editorReducer(state, { type: 'REMOVE_MASK', id: a.id })

    expect(next.masks).toEqual([b])
    expect(next.activeMaskId).toBe(b.id)
  })

  it('SET_MASK_ADJUSTMENT updates only the targeted mask', () => {
    const a = createMask('brush', 'Brush 1')
    const b = createMask('brush', 'Brush 2')
    const state = createState({ masks: [a, b] })

    const next = editorReducer(state, {
      type: 'SET_MASK_ADJUSTMENT',
      id: a.id,
      key: 'exposure',
      value: 1.5,
    })

    expect(next.masks[0].adjustments.exposure).toBe(1.5)
    expect(next.masks[1]).toBe(b) // untouched mask keeps its reference
  })

  it('SET_MASK_INVERT toggles the flag', () => {
    const mask = createMask('sky', 'Sky 1')
    const state = createState({ masks: [mask] })

    const next = editorReducer(state, { type: 'SET_MASK_INVERT', id: mask.id, invert: true })

    expect(next.masks[0].invert).toBe(true)
  })

  it('RENAME_MASK renames without marking the image dirty', () => {
    const mask = createMask('brush', 'Brush 1')
    const state = createState({ masks: [mask] })

    const next = editorReducer(state, { type: 'RENAME_MASK', id: mask.id, name: 'Sky' })

    expect(next.masks[0].name).toBe('Sky')
    expect(next.imageDirty).toBe(false)
  })

  it('ADD_BRUSH_STROKE appends the stroke and bumps the version', () => {
    const mask = createMask('brush', 'Brush 1')
    const state = createState({ masks: [mask] })

    const next = editorReducer(state, { type: 'ADD_BRUSH_STROKE', id: mask.id, stroke })

    expect(next.masks[0].strokes).toEqual([stroke])
    expect(next.masks[0].version).toBe(1)
    expect(next.imageDirty).toBe(true)
  })

  it('SET_MASK_GRADIENT sets the ramp and bumps the version', () => {
    const mask = createMask('linear', 'Linear Gradient 1')
    const state = createState({ masks: [mask] })
    const gradient = { x1: 0, y1: 0, x2: 100, y2: 200 }

    const next = editorReducer(state, { type: 'SET_MASK_GRADIENT', id: mask.id, gradient })

    expect(next.masks[0].gradient).toEqual(gradient)
    expect(next.masks[0].version).toBe(1)
    expect(next.imageDirty).toBe(true)
  })

  it('SET_MASK_PROMPT stores the prompt and bumps the version', () => {
    const mask = createMask('object', 'Select object 1')
    const state = createState({ masks: [mask] })
    const prompt = { points: [{ x: 0.5, y: 0.5, label: 1 as const }], box: null }

    const next = editorReducer(state, { type: 'SET_MASK_PROMPT', id: mask.id, prompt })

    expect(next.masks[0].prompt).toEqual(prompt)
    expect(next.masks[0].version).toBe(1)
    expect(next.imageDirty).toBe(true)
  })

  it('SET_MASK_VERSION publishes the exact version it is given', () => {
    const mask = createMask('subject', 'Subject 1')
    const state = createState({ masks: [mask] })

    const next = editorReducer(state, { type: 'SET_MASK_VERSION', id: mask.id, version: 7 })

    expect(next.masks[0].version).toBe(7)
    expect(next.imageDirty).toBe(true)
  })

  it('SET_MASK_VERSION leaves other masks alone', () => {
    const target = createMask('subject', 'Subject 1')
    const other = createMask('brush', 'Brush 1')
    const state = createState({ masks: [target, other] })

    const next = editorReducer(state, { type: 'SET_MASK_VERSION', id: target.id, version: 3 })

    expect(next.masks[1].version).toBe(other.version)
  })

  it('SET_MASK_VERSION ignores an unknown mask id', () => {
    const mask = createMask('subject', 'Subject 1')
    const state = createState({ masks: [mask] })

    const next = editorReducer(state, { type: 'SET_MASK_VERSION', id: 'nope', version: 5 })

    expect(next.masks[0].version).toBe(mask.version)
  })

  it('SET_ACTIVE_MASK selects and clears', () => {
    const mask = createMask('brush', 'Brush 1')
    const state = createState({ masks: [mask] })

    expect(editorReducer(state, { type: 'SET_ACTIVE_MASK', id: mask.id }).activeMaskId).toBe(mask.id)
    expect(editorReducer(state, { type: 'SET_ACTIVE_MASK', id: null }).activeMaskId).toBeNull()
  })

  it('SET_IMAGE clears any existing masks', () => {
    const state = createState({ masks: [createMask('brush', 'Brush 1')], activeMaskId: 'x' })

    const next = editorReducer(state, { type: 'SET_IMAGE', image: fakeImage })

    expect(next.masks).toEqual([])
    expect(next.activeMaskId).toBeNull()
  })
})
