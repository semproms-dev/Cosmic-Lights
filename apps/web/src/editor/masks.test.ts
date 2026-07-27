import { describe, expect, it } from 'vitest'
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  brushRadiusPx,
  buildMaskAdjustments,
  createMask,
  DEFAULT_BRUSH,
  stepBrushSize,
  EMPTY_OBJECT_PROMPT,
  isPromptEmpty,
  MASK_ADJUSTMENT_KEYS,
  MASK_TYPE_LABEL,
  MAX_MASKS,
  MASK_GRANULARITIES,
  promptBoxFromCorners,
  promptGranularity,
  withPromptPoint,
  withoutPromptPoint,
  withPromptGranularity,
} from './masks'
import type { ObjectPrompt } from './masks'

describe('mask helpers', () => {
  it('builds an all-zero adjustment map covering the mask keys', () => {
    const adjustments = buildMaskAdjustments()
    for (const key of MASK_ADJUSTMENT_KEYS) {
      expect(adjustments[key]).toBe(0)
    }
    // Exactly the mask keys, nothing more.
    expect(Object.keys(adjustments).sort()).toEqual([...MASK_ADJUSTMENT_KEYS].sort())
  })

  it('excludes the global blur-based sliders from mask adjustments', () => {
    // clarity/dehaze/texture stay global and must not be per-mask.
    expect(MASK_ADJUSTMENT_KEYS).not.toContain('clarity')
    expect(MASK_ADJUSTMENT_KEYS).not.toContain('dehaze')
    expect(MASK_ADJUSTMENT_KEYS).not.toContain('texture')
  })

  it('excludes the frame effects from mask adjustments', () => {
    // The vignette shades the displayed frame, not the pixel: a per-mask one
    // means nothing, and listing it here would print dead sliders on every mask.
    expect(MASK_ADJUSTMENT_KEYS).not.toContain('vignette')
    expect(MASK_ADJUSTMENT_KEYS).not.toContain('vignetteMidpoint')
    expect(MASK_ADJUSTMENT_KEYS).not.toContain('vignetteFeather')
  })

  it('includes the core tone and colour sliders', () => {
    for (const key of ['exposure', 'contrast', 'temperature', 'saturation']) {
      expect(MASK_ADJUSTMENT_KEYS).toContain(key)
    }
  })

  it('creates a mask with a unique id, defaults and no pixel data', () => {
    const a = createMask('brush', 'Brush 1')
    const b = createMask('brush', 'Brush 2')
    expect(a.id).not.toBe(b.id)
    expect(a.type).toBe('brush')
    expect(a.name).toBe('Brush 1')
    expect(a.invert).toBe(false)
    expect(a.strokes).toEqual([])
    expect(a.version).toBe(0)
    expect(a.adjustments).toEqual(buildMaskAdjustments())
  })

  it('exposes a label for every mask type and a sane cap', () => {
    expect(MASK_TYPE_LABEL.brush).toBe('Brush')
    expect(MASK_TYPE_LABEL.subject).toBe('Subject')
    expect(MASK_TYPE_LABEL.sky).toBe('Sky')
    expect(MAX_MASKS).toBeGreaterThan(0)
  })
})

describe('object prompt helpers', () => {
  it('starts empty and reports it', () => {
    expect(isPromptEmpty(EMPTY_OBJECT_PROMPT)).toBe(true)
    expect(isPromptEmpty({ points: [{ x: 0.5, y: 0.5, label: 1 }], box: null })).toBe(false)
    expect(isPromptEmpty({ points: [], box: { x0: 0, y0: 0, x1: 1, y1: 1 } })).toBe(false)
  })

  it('appends a point without mutating the prompt it was given', () => {
    const before: ObjectPrompt = { points: [{ x: 0.1, y: 0.2, label: 1 }], box: null }
    const after = withPromptPoint(before, { x: 0.7, y: 0.8 }, 0)
    expect(after.points).toEqual([
      { x: 0.1, y: 0.2, label: 1 },
      { x: 0.7, y: 0.8, label: 0 },
    ])
    expect(before.points).toHaveLength(1)
  })

  it('keeps the box when adding a point', () => {
    const box = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }
    expect(withPromptPoint({ points: [], box }, { x: 0.5, y: 0.5 }, 1).box).toEqual(box)
  })

  it('removes the point at an index and ignores out-of-range ones', () => {
    const prompt: ObjectPrompt = {
      points: [
        { x: 0.1, y: 0.1, label: 1 },
        { x: 0.2, y: 0.2, label: 0 },
      ],
      box: null,
    }
    expect(withoutPromptPoint(prompt, 0).points).toEqual([{ x: 0.2, y: 0.2, label: 0 }])
    expect(withoutPromptPoint(prompt, 5)).toBe(prompt)
    expect(withoutPromptPoint(prompt, -1)).toBe(prompt)
  })

  it('refuses to empty a prompt that has no box left to carry it', () => {
    // The uploaded alpha would survive the removal, leaving a selection the user
    // can no longer explain — so the last point stays put.
    const prompt: ObjectPrompt = { points: [{ x: 0.4, y: 0.4, label: 1 }], box: null }
    expect(withoutPromptPoint(prompt, 0)).toBe(prompt)
  })

  it('allows dropping the last point when a box still prompts the model', () => {
    const prompt: ObjectPrompt = {
      points: [{ x: 0.4, y: 0.4, label: 1 }],
      box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
    }
    const after = withoutPromptPoint(prompt, 0)
    expect(after.points).toEqual([])
    expect(isPromptEmpty(after)).toBe(false)
  })

  it('orders the box corners whichever way the drag ran', () => {
    const expected = { x0: 0.2, y0: 0.3, x1: 0.6, y1: 0.7 }
    expect(promptBoxFromCorners({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 })).toEqual(expected)
    expect(promptBoxFromCorners({ x: 0.2, y: 0.7 }, { x: 0.6, y: 0.3 })).toEqual(expected)
  })

  it('clamps a box that runs off the image', () => {
    expect(promptBoxFromCorners({ x: -0.4, y: 0.5 }, { x: 1.3, y: 2 })).toEqual({
      x0: 0,
      y0: 0.5,
      x1: 1,
      y1: 1,
    })
  })
})

describe('prompt granularity', () => {
  it('defaults to auto when the prompt has never said otherwise', () => {
    expect(promptGranularity(null)).toBe('auto')
    expect(promptGranularity({ points: [], box: null })).toBe('auto')
  })

  it('changes only the granularity, keeping the points that were placed', () => {
    const before: ObjectPrompt = { points: [{ x: 0.5, y: 0.5, label: 1 }], box: null }
    const after = withPromptGranularity(before, 'detail')
    expect(after.granularity).toBe('detail')
    expect(after.points).toEqual(before.points)
    expect(before.granularity).toBeUndefined()
  })

  it('returns the same prompt when nothing would change', () => {
    // Identity matters: the caller dispatches on the result, and a new object
    // would bump the mask version and re-run the decoder for nothing.
    const prompt: ObjectPrompt = { points: [], box: null, granularity: 'part' }
    expect(withPromptGranularity(prompt, 'part')).toBe(prompt)
    expect(withPromptGranularity({ points: [], box: null }, 'auto')).toEqual({ points: [], box: null })
  })

  it('offers the four choices, coarsest first', () => {
    expect(MASK_GRANULARITIES).toEqual(['auto', 'whole', 'part', 'detail'])
  })
})

describe('brush tool settings', () => {
  it('starts within its own bounds', () => {
    expect(DEFAULT_BRUSH.size).toBeGreaterThanOrEqual(BRUSH_SIZE_MIN)
    expect(DEFAULT_BRUSH.size).toBeLessThanOrEqual(BRUSH_SIZE_MAX)
    expect(DEFAULT_BRUSH.mode).toBe('add')
  })

  it('resizes multiplicatively, so a step feels the same at both ends', () => {
    const small = stepBrushSize(0.01, 1) / 0.01
    const large = stepBrushSize(0.2, 1) / 0.2
    expect(small).toBeCloseTo(large)
    expect(stepBrushSize(0.04, 1)).toBeGreaterThan(0.04)
    expect(stepBrushSize(0.04, -1)).toBeLessThan(0.04)
  })

  it('is reversible: a step out and back returns to the same size', () => {
    expect(stepBrushSize(stepBrushSize(0.04, 1), -1)).toBeCloseTo(0.04)
  })

  it('clamps at both ends instead of running off', () => {
    // Holding the key down must not leave the brush at zero or off the frame.
    expect(stepBrushSize(BRUSH_SIZE_MIN, -20)).toBe(BRUSH_SIZE_MIN)
    expect(stepBrushSize(BRUSH_SIZE_MAX, 20)).toBe(BRUSH_SIZE_MAX)
  })

  it('scales the radius to the short side, so it covers as much on any image', () => {
    // Same setting, landscape and portrait: the short side decides both times.
    expect(brushRadiusPx(0.1, 4000, 3000)).toBe(300)
    expect(brushRadiusPx(0.1, 3000, 4000)).toBe(300)
  })
})
