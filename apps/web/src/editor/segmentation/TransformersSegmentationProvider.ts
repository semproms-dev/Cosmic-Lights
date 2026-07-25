import { logger } from '../../logger'
import type {
  EmbedResponse,
  MaskAlpha,
  ModelLoadProgress,
  ModelPrompt,
  SegmentationKind,
  SegmentationRequest,
  SegmentationResponse,
  WorkerMessage,
} from './types'

const log = logger.forContext('segmentation.provider')

/**
 * Turns an image into a mask weight map. The engine behind it (a local model, a
 * remote service…) is deliberately hidden: masks only care about the alpha.
 */
export interface SegmentationProvider {
  /**
   * @param bitmap - The image to segment. **Consumed** — see the implementation.
   * @param kind - Which mask to generate.
   * @returns The weight map, at the provider's own resolution.
   */
  segment(bitmap: ImageBitmap, kind: SegmentationKind): Promise<MaskAlpha>
  /**
   * Segments the one object the user pointed at (SAM), rather than a fixed
   * category. Unlike {@link segment} this is meant to be called again on every
   * refinement of the prompt.
   *
   * @param bitmap - The image to segment. **Consumed**, like `segment`'s.
   * @param imageId - Identifies the open image, so the expensive image encoding
   * can be reused across prompts. Must change whenever the image does.
   * @param prompt - Points/box in normalised [0,1] image coordinates.
   * @returns The weight map, at the provider's own resolution.
   */
  segmentObject(bitmap: ImageBitmap, imageId: number, prompt: ModelPrompt): Promise<MaskAlpha>
  /** Releases the underlying resources. The provider is unusable afterwards. */
  dispose(): void
}

/**
 * The slice of `Worker` this provider drives. A real `Worker` satisfies it; the
 * narrower shape is what lets tests inject a fake without a DOM worker.
 */
export interface SegmentationWorker {
  postMessage(message: SegmentationRequest, transfer: Transferable[]): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

/** Construction-time knobs for {@link TransformersSegmentationProvider}. */
export interface TransformersSegmentationProviderOptions {
  /** Worker factory. Override in tests; defaults to the bundled worker. */
  createWorker?: () => SegmentationWorker
  /**
   * Called as the model downloads, then once with `phase: 'ready'`. Fires at
   * most once per session's worth of loading — the model is fetched once.
   */
  onModelProgress?: (progress: ModelLoadProgress) => void
}

/** Builds the real worker. Kept lazy: importing it pulls in transformers.js. */
function createSegmentationWorker(): SegmentationWorker {
  return new Worker(new URL('./segmentation.worker.ts', import.meta.url), { type: 'module' })
}

interface PendingJob {
  resolve: (alpha: MaskAlpha) => void
  reject: (error: Error) => void
}

/**
 * An `embed` waiting for its acknowledgement. It cannot share {@link PendingJob}'s
 * map: an embed answers with no pixels, only "the encoder ran".
 */
interface PendingEmbed {
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * Runs segmentation on a transformers.js worker, one job at a time from the
 * caller's point of view but multiplexed by request id, so overlapping calls
 * never cross their results.
 *
 * The worker (and with it the model download) is created on the **first**
 * `segment` call, not on construction: a user who never asks for an AI mask
 * should never pay for the inference runtime.
 */
export class TransformersSegmentationProvider implements SegmentationProvider {
  private readonly createWorker: () => SegmentationWorker
  private readonly onModelProgress?: (progress: ModelLoadProgress) => void
  private readonly pending = new Map<number, PendingJob>()
  private readonly pendingEmbed = new Map<number, PendingEmbed>()
  /**
   * The in-flight *or* finished image encoding, per image. Sharing the promise
   * (rather than a boolean flag) is what keeps two prompts arriving on the same
   * image from each paying for the encoder.
   */
  private embedding: { imageId: number; promise: Promise<void> } | null = null
  private worker: SegmentationWorker | null = null
  private nextId = 0
  private disposed = false

  /**
   * @param options - See {@link TransformersSegmentationProviderOptions}.
   */
  constructor(options: TransformersSegmentationProviderOptions = {}) {
    this.createWorker = options.createWorker ?? createSegmentationWorker
    this.onModelProgress = options.onModelProgress
  }

  /**
   * Segments `bitmap`.
   *
   * **The bitmap is consumed**: it is transferred to the worker (zero-copy) and
   * closed on every failure path, so it is unusable when this returns. Callers
   * that still need the pixels must pass a `createImageBitmap` clone.
   *
   * @param bitmap - The image to segment.
   * @param kind - Only `subject` is implemented; `sky` needs a semantic model.
   * @returns The weight map at the model's resolution, not the image's.
   */
  segment(bitmap: ImageBitmap, kind: SegmentationKind): Promise<MaskAlpha> {
    if (this.disposed) {
      bitmap.close()
      return Promise.reject(new Error('This segmentation provider was disposed'))
    }
    if (kind !== 'subject') {
      // Answering with a subject mask would be a plausible-looking lie.
      bitmap.close()
      return Promise.reject(new Error(`Segmentation of "${kind}" is not implemented yet`))
    }

    const id = this.nextId++
    return new Promise<MaskAlpha>((resolve, reject) => {
      try {
        const worker = this.ensureWorker()
        this.pending.set(id, { resolve, reject })
        worker.postMessage({ op: 'segment', id, bitmap }, [bitmap])
      } catch (error) {
        this.pending.delete(id)
        bitmap.close()
        log.error(`Could not dispatch segmentation request ${id}`, error)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Terminates the worker and rejects everything still in flight. Safe to call
   * twice, and safe to call before any `segment` (no worker was ever built).
   */
  dispose(): void {
    this.disposed = true
    this.embedding = null
    this.failAll(new Error('The segmentation provider was disposed'))
    if (this.worker !== null) {
      this.worker.terminate()
      this.worker = null
    }
  }

  private ensureWorker(): SegmentationWorker {
    if (this.worker !== null) return this.worker
    const worker = this.createWorker()
    worker.onmessage = (event: MessageEvent<WorkerMessage>): void => {
      const message = event.data
      if (message.kind === 'model-progress') {
        this.onModelProgress?.(message)
        return
      }
      if (message.kind === 'embedded') {
        this.settleEmbed(message)
        return
      }
      // `decode` answers with `kind: 'result'` too, so it settles through the
      // very same path as `segment`.
      this.settle(message)
    }
    // A worker that dies (chunk failed to load, OOM…) will never answer, so its
    // jobs must be failed here or they hang forever.
    worker.onerror = (event: ErrorEvent): void => {
      const reason = event.message === '' ? 'Segmentation worker crashed' : event.message
      log.error(`Segmentation worker error: ${reason}`)
      // Drop the corpse so `ensureWorker` builds a fresh one, and forget the
      // embedding with it: the new worker's cache is empty, so believing the
      // image is still encoded would make every later `decode` fail.
      this.worker = null
      this.embedding = null
      this.failAll(new Error(reason))
    }
    this.worker = worker
    return worker
  }

  private settle(response: SegmentationResponse): void {
    const job = this.pending.get(response.id)
    if (job === undefined) return // Already settled by dispose or a worker crash.
    this.pending.delete(response.id)
    if (response.ok) {
      job.resolve({ data: response.data, width: response.width, height: response.height })
    } else {
      job.reject(new Error(response.error))
    }
  }

  private settleEmbed(response: EmbedResponse): void {
    const job = this.pendingEmbed.get(response.id)
    if (job === undefined) return // Already settled by dispose or a worker crash.
    this.pendingEmbed.delete(response.id)
    if (response.ok) {
      job.resolve()
    } else {
      job.reject(new Error(response.error))
    }
  }

  /**
   * Segments the object the prompt points at.
   *
   * **The bitmap is consumed** on every path, exactly like {@link segment}'s: it
   * is transferred to the worker for the image encoding, or closed on the spot
   * when that encoding already exists. Pass a `createImageBitmap` clone.
   *
   * Only the first prompt of an image pays for the encoder; the rest run the
   * (cheap) mask decoder against the cached embedding, which is what makes
   * click-refine usable even on the WASM backend.
   *
   * @param bitmap - The image to segment.
   * @param imageId - Identifies the open image for the embedding cache.
   * @param prompt - Points/box in normalised [0,1] image coordinates.
   * @returns The weight map at the model's resolution, not the image's.
   */
  segmentObject(bitmap: ImageBitmap, imageId: number, prompt: ModelPrompt): Promise<MaskAlpha> {
    if (this.disposed) {
      bitmap.close()
      return Promise.reject(new Error('This segmentation provider was disposed'))
    }
    // `ensureEmbedded` takes ownership of the bitmap (consumes or closes it), so
    // nothing below touches it again: embed once per image, decode per prompt.
    return this.ensureEmbedded(imageId, bitmap).then(() => this.decode(imageId, prompt))
  }

  /** SAM stage 1. Consumes `bitmap`. Resolves when the worker acknowledges. */
  private embed(imageId: number, bitmap: ImageBitmap): Promise<void> {
    const id = this.nextId++
    return new Promise<void>((resolve, reject) => {
      try {
        const worker = this.ensureWorker()
        this.pendingEmbed.set(id, { resolve, reject })
        worker.postMessage({ op: 'embed', id, imageId, bitmap }, [bitmap])
      } catch (error) {
        this.pendingEmbed.delete(id)
        bitmap.close() // The contract: the bitmap is always consumed.
        log.error(`Could not dispatch embed request ${id}`, error)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** SAM stage 2. Transfers nothing — the worker holds the embedded image. */
  private decode(imageId: number, prompt: ModelPrompt): Promise<MaskAlpha> {
    const id = this.nextId++
    return new Promise<MaskAlpha>((resolve, reject) => {
      try {
        const worker = this.ensureWorker()
        // The same map as `segment`: a decode answers with `kind: 'result'`, so
        // `settle` already knows how to resolve it.
        this.pending.set(id, { resolve, reject })
        worker.postMessage({ op: 'decode', id, imageId, prompt }, [])
      } catch (error) {
        this.pending.delete(id)
        log.error(`Could not dispatch decode request ${id}`, error)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Resolves once `imageId` is encoded in the worker, encoding it if needed.
   * Owns `bitmap` either way — it consumes it (a fresh encoding) or closes it
   * (already encoded, or a redundant clone from a concurrent prompt).
   */
  private ensureEmbedded(imageId: number, bitmap: ImageBitmap): Promise<void> {
    const current = this.embedding
    if (current !== null && current.imageId === imageId) {
      bitmap.close()
      return current.promise
    }
    const promise = this.embed(imageId, bitmap)
    this.embedding = { imageId, promise }
    // A failed embed must not be remembered as done, or every later decode of
    // this image would fail against an embedding that never existed.
    promise.catch(() => {
      if (this.embedding?.promise === promise) this.embedding = null
    })
    return promise
  }

  private failAll(error: Error): void {
    for (const job of this.pending.values()) {
      job.reject(error)
    }
    this.pending.clear()
    for (const job of this.pendingEmbed.values()) {
      job.reject(error)
    }
    this.pendingEmbed.clear()
  }
}
