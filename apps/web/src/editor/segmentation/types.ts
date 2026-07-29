import type { MaskType } from '../masks'

export interface MaskAlpha {
  data: Uint8Array   // 1 byte/píxel (0..255) — peso de la selección
  width: number
  height: number
}

/**
 * The mask kinds a model generates, as opposed to the hand-painted `brush` or
 * the rasterised `linear` gradient. Both of those are excluded — only AI masks
 * run through the segmentation worker.
 *
 * `identify` is excluded too, for a different reason: it is answered by a remote
 * service that returns a species name and no pixels, so it never reaches this
 * worker. Leaving it in would let `provider.segment(bitmap, 'identify')` compile
 * and then fail at runtime with "not implemented".
 */
export type SegmentationKind = Exclude<MaskType, 'brush' | 'linear' | 'radial' | 'object' | 'identify'>

/**
 * A generated alpha, tagged with the `Mask.version` it was produced for.
 *
 * The tag is what lets `syncMasks` tell a fresh alpha from a stale one left over
 * by an earlier version of the same mask.
 */
export interface CachedMaskAlpha extends MaskAlpha {
  version: number
}

/** How a mask's segmentation is doing. Absent means "not an AI mask". */
export type MaskStatus = 'loading' | 'ready' | 'error'

/**
 * Generated alphas, keyed by mask id.
 *
 * This is the glue of the AI-mask feature: segmentation is kicked off from the
 * store, but the renderer that consumes the pixels is owned by the Canvas, and
 * undo/redo needs the same bytes back. One map, read by all three.
 *
 * It deliberately lives *outside* the reducer and the history stacks: a 24 MP
 * alpha is ~24 MB, which would be copied into every undo checkpoint. The history
 * keeps the cheap metadata (`Mask.version`); the heavy pixels live here.
 */
export type MaskAlphaCache = Map<string, CachedMaskAlpha>

/**
 * Which reading of an ambiguous click to keep.
 *
 * A click is ambiguous by design — clicking an eye could mean the eye, the face
 * or the person — and SAM answers with all three at once. Its confidence scores
 * do not rank them by what the user meant (measured: a face scored 0.874 against
 * the eye's 0.717), so the choice is the user's to make. `auto` guesses, the rest
 * name a rung on the size ladder the candidates form.
 */
export type MaskGranularity = 'auto' | 'whole' | 'part' | 'detail'

/**
 * A promptable-segmentation prompt (SAM), in **normalised [0,1] image
 * coordinates** so the worker can scale it to whatever resolution it fed the
 * model. The main thread never needs to know the model's internal size.
 */
export interface ModelPrompt {
  /**
   * Foreground/background points. `label` 1 = the object *contains* this pixel
   * (a click); 0 = it *does not* (a shift-click, to carve the selection back).
   */
  points: { x: number; y: number; label: 0 | 1 }[]
  /** An optional bounding box, corners in [0,1] as `(x0,y0)`–`(x1,y1)`. */
  box: { x0: number; y0: number; x1: number; y1: number } | null
  /** Which candidate to keep; absent means {@link MaskGranularity} `'auto'`. */
  granularity?: MaskGranularity
}

/**
 * A job sent from the main thread to the worker. Discriminate on `op`:
 * - `segment` — one-shot background removal (Subject), as before.
 * - `embed` — SAM stage 1: run the (expensive) image encoder once per image and
 *   cache its embedding, keyed by `imageId`.
 * - `decode` — SAM stage 2: run the (cheap) mask decoder against the cached
 *   embedding for a given prompt. Reuses the embedding whenever `imageId` matches.
 *
 * The `bitmap` of `segment`/`embed` is *transferred*, not copied, so the sender
 * must clone it (`createImageBitmap`) if it still needs the pixels.
 */
export type SegmentationRequest =
  | { op: 'segment'; id: number; bitmap: ImageBitmap }
  | { op: 'embed'; id: number; imageId: number; bitmap: ImageBitmap }
  | { op: 'decode'; id: number; imageId: number; prompt: ModelPrompt }

/** A completed segmentation: the alpha map, ready for `uploadMaskAlpha`. */
export interface SegmentationSuccess extends MaskAlpha {
  kind: 'result'
  id: number
  ok: true
}

/** A failed segmentation. `error` is a message, not an `Error` (not cloneable). */
export interface SegmentationFailure {
  kind: 'result'
  id: number
  ok: false
  error: string
}

/** The terminal answer to one request. Discriminate on `ok`. */
export type SegmentationResponse = SegmentationSuccess | SegmentationFailure

/**
 * How the one-time model load is going.
 *
 * Deliberately **not** tied to a request id: there is one model, downloaded
 * once, and every mask queued at that moment is waiting on the same bytes. The
 * request that happened to trigger the load has no special claim on it.
 */
export type ModelLoadProgress =
  | {
      kind: 'model-progress'
      phase: 'downloading'
      /** 0..100 across every file of the model. */
      progress: number
      loaded: number
      total: number
    }
  /** The pipeline is built. Any further wait is inference, not download. */
  | { kind: 'model-progress'; phase: 'ready' }

/**
 * The answer to an `embed` request: the image encoder ran (or failed). Carries
 * no pixels — a successful embed just means a later `decode` for the same
 * `imageId` can skip straight to the mask decoder.
 */
export interface EmbedSuccess {
  kind: 'embedded'
  id: number
  /** The image the embedding was cached under, echoed back for confirmation. */
  imageId: number
  ok: true
}

/** A failed `embed`. `error` is a message, not an `Error` (not cloneable). */
export interface EmbedFailure {
  kind: 'embedded'
  id: number
  ok: false
  error: string
}

/** The terminal answer to one `embed` request. Discriminate on `ok`. */
export type EmbedResponse = EmbedSuccess | EmbedFailure

/** Anything the worker posts back. Discriminate on `kind`. */
export type WorkerMessage = SegmentationResponse | EmbedResponse | ModelLoadProgress
