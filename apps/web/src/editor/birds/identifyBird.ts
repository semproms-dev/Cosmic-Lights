import { z } from 'zod'
import { logger } from '../../logger'

const log = logger.forContext('birds.identify')

/**
 * Where the identification service lives.
 *
 * The default is **relative on purpose**: it goes through the dev-server proxy
 * declared in `vite.config.ts`, which forwards `/api/birds/*` to the local Flask
 * instance. Calling that service directly from the browser does not work — it
 * sends no `Access-Control-Allow-Origin`, so the response is blocked before the
 * app can read it, and a same-origin request is not subject to CORS at all.
 *
 * Set `VITE_BIRD_API_URL` to an absolute URL to bypass the proxy (only useful
 * once the service itself answers with CORS headers).
 */
export const BIRD_ENDPOINT: string =
  (import.meta.env.VITE_BIRD_API_URL as string | undefined) ?? '/api/birds/predict'

/**
 * How sure the service must be before the app claims there is a bird.
 *
 * The service always answers with its top-1 guess, so without a floor every
 * photo "contains" a bird. Calibrated from two measurements (2026-07-29): a real
 * subject scored 0.6958, while a flat colour field with no bird in it still
 * scored 0.4978. This sits between them — provisional, and the first number to
 * revisit once there are more samples than that.
 */
export const MIN_CONFIDENCE = 0.6

/**
 * The species name as a person reads it: the model emits `Coracias_benghalensis`
 * and a photographer expects `Coracias benghalensis`.
 *
 * Never translated. A scientific name is the same in every locale, and running
 * it through i18next would only invite a "missing key" warning per species.
 */
export function speciesDisplayName(label: string): string {
  return label.replace(/_/g, ' ').trim()
}

/**
 * How the identification of the open photo is going.
 *
 * `ready` says the service answered, not that it found something: paired with a
 * null `birdSpecies` it is the "no bird here" case, which a panel has to word
 * differently from `error` ("the service did not answer") — one is an answer,
 * the other is a failure, and a user reads them very differently.
 */
export type BirdStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * The confidence as a percentage string, one decimal: `0.6958` → `"69.6"`.
 *
 * One decimal because the service reports four and none of them helps a person
 * decide anything: the useful reading is "about 70%", and a wall of digits reads
 * as a precision the classifier does not have. The `%` sign is left to the
 * locale string, which is what puts it on the right side in every language.
 */
export function formatConfidence(confidence: number): string {
  return (confidence * 100).toFixed(1)
}

/** What the service says about a photo, already interpreted. */
export interface BirdIdentification {
  /** Scientific name exactly as the model emits it: `Coracias_benghalensis`. */
  label: string
  /** The model's confidence, 0..1. Absent in the payload becomes 0. */
  confidence: number
  /**
   * A non-fatal remark from the service, for the log only.
   *
   * The service sends `error` *alongside* a perfectly good label (its species
   * lookup failing does not invalidate the classification), so this is
   * deliberately not modelled as a failure — see {@link identifyBird}.
   */
  note: string | null
  description: string | null
}

/**
 * The service's payload. Every field is optional on purpose: the classifier
 * answers with `label` + `confidence`, the species-info lookup adds `error` when
 * it has nothing to say about that label, and a photo with no bird has no label
 * at all. Validating them as required would turn each of those into a crash.
 */
const responseSchema = z.object({
  label: z.string().min(1).optional(),
  confidence: z.number().optional(),
  error: z.string().optional(),
  description: z.string().nullable()
})

/**
 * Reads a response body as JSON, or `null` if it is not JSON at all (an HTML
 * error page from a proxy, an empty body). Returning instead of throwing lets
 * the caller report the status, which is the useful half of that failure.
 */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** Options for {@link identifyBird}. All optional; the defaults are the app's. */
export interface IdentifyBirdOptions {
  /** Overrides {@link BIRD_ENDPOINT}. */
  endpoint?: string
  /** Cancels the request (mask deleted, image closed, app unmounted). */
  signal?: AbortSignal
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * Asks the identification service which bird is in `image`.
 *
 * The two failure modes are kept apart on purpose, because they mean different
 * things to whoever is watching:
 *
 * - **No bird in the photo** → resolves to `null`. Nothing went wrong.
 * - **The service is unreachable, errored or answered nonsense** → throws.
 *
 * **The body decides, not the status.** An identification that arrives with a
 * non-2xx status is still an identification: the service has answered a
 * successful classification with `404` when its species sheet was missing, so
 * trusting `response.ok` binned perfectly good answers. The status only decides
 * when the body has nothing usable in it.
 *
 * @param image - The frame to classify, already encoded (JPEG; see `frameToJpeg`).
 * @param options - Endpoint, abort signal and `fetch` override.
 * @returns The identification, or `null` when the service found no bird.
 * @throws If the request fails, the body is not the expected shape, or the
 * status is not 2xx and the body carries no identification.
 */
export async function identifyBird(
  image: Blob,
  options: IdentifyBirdOptions = {},
): Promise<BirdIdentification | null> {
  try {
    const endpoint = options.endpoint ?? BIRD_ENDPOINT
    const doFetch = options.fetchImpl ?? fetch
    const body = new FormData()
    // The field is named `image` to match the service's `-F "image=@photo.jpg"`.
    // Content-Type is left unset on purpose: FormData writes its own multipart
    // boundary, and setting the header by hand replaces it with one that has no
    // boundary at all, which the server cannot parse.
    body.append('image', image, 'frame.jpg')
    const response = await doFetch(endpoint, { method: 'POST', body, signal: options.signal })
    // Read the body before judging the status: the service has been seen
    // answering 404 with a valid identification in it.
    const parsed = responseSchema.safeParse(await readJson(response))
    if (!parsed.success) {
      throw new Error(
        `The bird service answered ${response.status} ${response.statusText} with an unexpected body`,
      )
    }
    const payload = parsed.data
    if (payload.label !== undefined) {
      // Worth seeing in the console — a 2xx would be the honest answer here —
      // but not worth throwing away the classification over.
      if (!response.ok) {
        log.warn(`The bird service answered ${response.status} but identified "${payload.label}"`)
      }
      return {
        label: payload.label,
        confidence: payload.confidence ?? 0,
        note: payload.error ?? null,
        description: payload.description
      }
    }
    // No label and a bad status: nothing usable, and the status is the only
    // evidence of why. Now it decides.
    if (!response.ok) {
      throw new Error(`The bird service answered ${response.status} ${response.statusText}`)
    }
    // No label on a 2xx = no bird. `error` may explain why, but it is not a failure.
    return null
  } catch (error) {
    log.error('The bird identification request failed', error)
    throw error
  }
}
