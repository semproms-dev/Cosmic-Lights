import { logger } from '../../logger'
import type {
  MaskAlpha,
  ModelLoadProgress,
  SegmentationKind,
  SegmentationRequest,
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
        worker.postMessage({ id, bitmap }, [bitmap])
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
      this.settle(message)
    }
    // A worker that dies (chunk failed to load, OOM…) will never answer, so its
    // jobs must be failed here or they hang forever.
    worker.onerror = (event: ErrorEvent): void => {
      const reason = event.message === '' ? 'Segmentation worker crashed' : event.message
      log.error(`Segmentation worker error: ${reason}`)
      this.failAll(new Error(reason))
    }
    this.worker = worker
    return worker
  }

  private settle(response: Exclude<WorkerMessage, ModelLoadProgress>): void {
    const job = this.pending.get(response.id)
    if (job === undefined) return // Already settled by dispose or a worker crash.
    this.pending.delete(response.id)
    if (response.ok) {
      job.resolve({ data: response.data, width: response.width, height: response.height })
    } else {
      job.reject(new Error(response.error))
    }
  }

  private failAll(error: Error): void {
    for (const job of this.pending.values()) {
      job.reject(error)
    }
    this.pending.clear()
  }
}
