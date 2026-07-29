import { describe, expect, it, vi } from 'vitest'
import { MIN_CONFIDENCE, formatConfidence, identifyBird, speciesDisplayName } from './identifyBird'

/** A `fetch` stand-in that answers with `body` and records what it was sent. */
function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: { url: string; request: RequestInit }[] = []
  const impl = vi.fn(async (url: string | URL | Request, request?: RequestInit) => {
    calls.push({ url: String(url), request: request ?? {} })
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: 'Test',
      json: async () => body,
    } as Response
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const image = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })

describe('speciesDisplayName', () => {
  it('turns the model label into a readable name', () => {
    expect(speciesDisplayName('Coracias_benghalensis')).toBe('Coracias benghalensis')
  })

  it('leaves a name with no underscores alone', () => {
    expect(speciesDisplayName('Robin')).toBe('Robin')
  })
})

describe('formatConfidence', () => {
  it('renders the service value as a one-decimal percentage', () => {
    expect(formatConfidence(0.6958)).toBe('69.6')
  })

  it('keeps the decimal on a round value, so the row does not jump about', () => {
    expect(formatConfidence(0.5)).toBe('50.0')
  })

  it('carries no percent sign: that belongs to the locale string', () => {
    expect(formatConfidence(0.42)).not.toContain('%')
  })
})

describe('MIN_CONFIDENCE', () => {
  it('sits between the two measured samples', () => {
    // 2026-07-29, against the real service: a photo with a bird scored 0.6958,
    // a flat colour field with none still scored 0.4978. The threshold only
    // earns its keep while it separates them — if this fails, it was moved
    // without new evidence.
    expect(MIN_CONFIDENCE).toBeGreaterThan(0.4978)
    expect(MIN_CONFIDENCE).toBeLessThanOrEqual(0.6958)
  })
})

describe('identifyBird', () => {
  it('returns the label and confidence the service reports', async () => {
    const { impl } = fakeFetch({ label: 'Coracias_benghalensis', confidence: 0.6958 })

    const result = await identifyBird(image, { endpoint: '/predict', fetchImpl: impl })

    expect(result).toEqual({
      label: 'Coracias_benghalensis',
      confidence: 0.6958,
      note: null,
    })
  })

  it('treats an `error` next to a valid label as a note, not a failure', async () => {
    // The real service answers exactly like this when it classifies the bird but
    // has no species sheet for that name. Throwing here would bin good results.
    const { impl } = fakeFetch({
      confidence: 0.6958,
      error: "No species info found for 'Coracias_benghalensis'",
      label: 'Coracias_benghalensis',
    })

    const result = await identifyBird(image, { endpoint: '/predict', fetchImpl: impl })

    expect(result?.label).toBe('Coracias_benghalensis')
    expect(result?.note).toBe("No species info found for 'Coracias_benghalensis'")
  })

  it('resolves to null when the service reports no bird', async () => {
    // No label = nothing was recognised. That is an answer, not an error.
    const { impl } = fakeFetch({ error: 'No bird detected' })

    await expect(identifyBird(image, { endpoint: '/predict', fetchImpl: impl })).resolves.toBeNull()
  })

  it('defaults a missing confidence to 0 instead of NaN', async () => {
    const { impl } = fakeFetch({ label: 'Turdus_merula' })

    const result = await identifyBird(image, { endpoint: '/predict', fetchImpl: impl })

    expect(result?.confidence).toBe(0)
  })

  it('posts the image as multipart under the field the service expects', async () => {
    const { impl, calls } = fakeFetch({ label: 'Turdus_merula', confidence: 0.9 })

    await identifyBird(image, { endpoint: '/predict', fetchImpl: impl })

    expect(calls[0].url).toBe('/predict')
    expect(calls[0].request.method).toBe('POST')
    const body = calls[0].request.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('image')).toBeInstanceOf(Blob)
    // Setting Content-Type by hand would strip FormData's multipart boundary.
    expect(calls[0].request.headers).toBeUndefined()
  })

  it('keeps an identification that arrives with a non-2xx status', async () => {
    // The service has answered exactly this — a classification it could find no
    // species sheet for — with a 404 carrying the result. Trusting response.ok
    // threw away good identifications, so the body decides and the status does
    // not. Guards the rule even if the service starts answering 200.
    const { impl } = fakeFetch(
      {
        confidence: 0.4978,
        error: "No species info found for 'Dendronanthus_indicus'",
        label: 'Dendronanthus_indicus',
      },
      { ok: false, status: 404 },
    )

    const result = await identifyBird(image, { endpoint: '/predict', fetchImpl: impl })

    expect(result?.label).toBe('Dendronanthus_indicus')
    expect(result?.confidence).toBe(0.4978)
  })

  it('throws on an error status when the body carries no identification', async () => {
    const { impl } = fakeFetch({ error: 'Boom' }, { ok: false, status: 500 })

    await expect(identifyBird(image, { endpoint: '/predict', fetchImpl: impl })).rejects.toThrow(
      /500/,
    )
  })

  it('throws when the body is not JSON at all (an HTML error page)', async () => {
    const impl = vi.fn(async () => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    })) as unknown as typeof fetch

    await expect(identifyBird(image, { endpoint: '/predict', fetchImpl: impl })).rejects.toThrow(
      /502/,
    )
  })

  it('throws when the body is not the shape we expect', async () => {
    const { impl } = fakeFetch({ label: 42 })

    await expect(identifyBird(image, { endpoint: '/predict', fetchImpl: impl })).rejects.toThrow()
  })

  it('propagates a transport failure (service down, CORS, offline)', async () => {
    const impl = vi.fn(async () => {
      throw new Error('Failed to fetch')
    }) as unknown as typeof fetch

    await expect(identifyBird(image, { endpoint: '/predict', fetchImpl: impl })).rejects.toThrow(
      'Failed to fetch',
    )
  })

  it('passes the abort signal through to fetch', async () => {
    const { impl, calls } = fakeFetch({ label: 'Turdus_merula', confidence: 0.9 })
    const controller = new AbortController()

    await identifyBird(image, {
      endpoint: '/predict',
      fetchImpl: impl,
      signal: controller.signal,
    })

    expect(calls[0].request.signal).toBe(controller.signal)
  })
})
