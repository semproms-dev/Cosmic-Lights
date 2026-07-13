import { describe, expect, it } from 'vitest'
import {
  buildMaskAdjustments,
  createMask,
  MASK_ADJUSTMENT_KEYS,
  MASK_TYPE_LABEL,
  MAX_MASKS,
} from './masks'

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
