import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId } from './createId'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createId', () => {
  it('returns a valid v4 UUID', () => {
    expect(createId()).toMatch(UUID_V4)
  })

  it('gives unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, createId))
    expect(ids.size).toBe(1000)
  })

  it('still yields valid v4 ids where randomUUID is missing (plain HTTP)', () => {
    // Simulates an insecure context (the Raspberry Pi over http://): the
    // platform keeps `crypto.getRandomValues` but hides `randomUUID`.
    const fallbackCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    vi.stubGlobal('crypto', fallbackCrypto)
    const [a, b] = [createId(), createId()]
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })

  it('sets the version and variant bits on the fallback path', () => {
    const fallbackCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
    vi.stubGlobal('crypto', fallbackCrypto)
    const id = createId()
    expect(id[14]).toBe('4')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })
})
