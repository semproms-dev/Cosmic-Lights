import { describe, expect, it } from 'vitest'
import { IDENTITY_CURVE } from './curves'
import {
  BUILTIN_PRESETS,
  PRESET_KINDS,
  groupPresets,
  presetAdjustments,
  presetCurves,
  type Preset,
} from './presets'

const style: Preset = {
  id: 'a',
  name: 'A',
  kind: 'style',
  adjustments: { contrast: 20 },
  curves: { rgb: [{ x: 0, y: 10 }, { x: 255, y: 255 }] },
}

const plain: Preset = {
  id: 'b',
  name: 'B',
  kind: 'color',
  adjustments: { saturation: -10 },
}

const mono: Preset = {
  id: 'c',
  name: 'C',
  kind: 'bw',
  adjustments: {},
}

const alsoColor: Preset = {
  id: 'd',
  name: 'D',
  kind: 'color',
  adjustments: { vibrance: 10 },
}

describe('BUILTIN_PRESETS', () => {
  it('gives every preset a unique id', () => {
    const ids = BUILTIN_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('files every preset under a known family', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(PRESET_KINDS).toContain(preset.kind)
    }
  })
})

describe('groupPresets', () => {
  it('orders the folders by PRESET_KINDS, not by the catalogue', () => {
    // `mono` comes first in the catalogue, but B&W is not the first family.
    const groups = groupPresets([mono, plain, style])
    expect([...groups.keys()]).toEqual(['style', 'color', 'bw'])
  })

  it('keeps the catalogue order inside a folder', () => {
    const groups = groupPresets([alsoColor, plain])
    expect(groups.get('color')).toEqual([alsoColor, plain])
  })

  it('leaves out the families with no presets', () => {
    const groups = groupPresets([style])
    expect([...groups.keys()]).toEqual(['style'])
  })

  it('returns an empty map for an empty catalogue', () => {
    expect(groupPresets([]).size).toBe(0)
  })
})

describe('presetAdjustments', () => {
  it('overrides the base with the keys the preset names', () => {
    const result = presetAdjustments({ contrast: 0, exposure: 1 }, style)
    expect(result).toEqual({ contrast: 20, exposure: 1 })
  })

  it('leaves the base untouched', () => {
    const base = { contrast: 0 }
    presetAdjustments(base, style)
    expect(base).toEqual({ contrast: 0 })
  })
})

describe('presetCurves', () => {
  it('keeps the identity on every channel the preset does not redefine', () => {
    const curves = presetCurves(style)
    expect(curves.rgb).toEqual([{ x: 0, y: 10 }, { x: 255, y: 255 }])
    expect(curves.red).toEqual(IDENTITY_CURVE)
    expect(curves.green).toEqual(IDENTITY_CURVE)
    expect(curves.blue).toEqual(IDENTITY_CURVE)
  })

  it('returns all-identity curves for a preset with no curves', () => {
    const curves = presetCurves(plain)
    expect(curves.rgb).toEqual(IDENTITY_CURVE)
  })

  it('copies the points so editing them cannot mutate the catalogue', () => {
    const curves = presetCurves(style)
    curves.rgb[0].y = 99
    expect(style.curves?.rgb?.[0].y).toBe(10)
    expect(presetCurves(style).rgb[0].y).toBe(10)
  })
})
