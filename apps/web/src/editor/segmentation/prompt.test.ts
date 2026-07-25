import { describe, expect, it } from 'vitest'
import { buildPromptArrays } from './prompt'

describe('buildPromptArrays', () => {
  it('scales points to the pixels the model was fed', () => {
    const options = buildPromptArrays(
      { points: [{ x: 0.5, y: 0.25, label: 1 }], box: null },
      1024,
      768,
    )
    expect(options.input_points).toEqual([[[512, 192]]])
    expect(options.input_labels).toEqual([[1]])
    expect(options.input_boxes).toBeUndefined()
  })

  it('keeps foreground and background points in one batch, in order', () => {
    const options = buildPromptArrays(
      {
        points: [
          { x: 0, y: 0, label: 1 },
          { x: 1, y: 1, label: 0 },
        ],
        box: null,
      },
      100,
      200,
    )
    expect(options.input_points).toEqual([[[0, 0], [100, 200]]])
    expect(options.input_labels).toEqual([[1, 0]])
  })

  it('scales the box corners as x0,y0,x1,y1', () => {
    const options = buildPromptArrays(
      { points: [{ x: 0.5, y: 0.5, label: 1 }], box: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.8 } },
      1000,
      500,
    )
    expect(options.input_boxes).toEqual([[[100, 100, 600, 400]]])
  })

  it('adds the box centre as a point when the prompt has no points', () => {
    // transformers.js 4.2.0 cannot express a box-only prompt: SamModel.forward
    // derives missing labels from `input_points.dims` and throws without them,
    // while the processor rejects labels that arrive without points.
    const options = buildPromptArrays(
      { points: [], box: { x0: 0.2, y0: 0.4, x1: 0.6, y1: 0.8 } },
      100,
      100,
    )
    const [[[x, y]]] = options.input_points ?? [[[NaN, NaN]]]
    expect(x).toBeCloseTo(40)
    expect(y).toBeCloseTo(60)
    expect(options.input_labels).toEqual([[1]])
    expect(options.input_boxes).toEqual([[[20, 40, 60, 80]]])
  })

  it('leaves the user points alone when a box accompanies them', () => {
    const options = buildPromptArrays(
      { points: [{ x: 0.9, y: 0.9, label: 0 }], box: { x0: 0, y0: 0, x1: 1, y1: 1 } },
      10,
      10,
    )
    expect(options.input_points).toEqual([[[9, 9]]])
    expect(options.input_labels).toEqual([[0]])
  })

  it('says nothing at all for an empty prompt', () => {
    expect(buildPromptArrays({ points: [], box: null }, 100, 100)).toEqual({})
  })
})
