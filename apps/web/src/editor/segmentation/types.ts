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
 */
export type SegmentationKind = Exclude<MaskType, 'brush' | 'linear'>

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

/** A segmentation job sent from the main thread to the worker. */
export interface SegmentationRequest {
  /** Correlates the response with the caller's pending promise. */
  id: number
  /**
   * The image to segment. This is *transferred* to the worker, not copied, so
   * the sender must clone it (`createImageBitmap`) if it still needs the pixels.
   */
  bitmap: ImageBitmap
}

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

/** Anything the worker posts back. Discriminate on `kind`. */
export type WorkerMessage = SegmentationResponse | ModelLoadProgress
