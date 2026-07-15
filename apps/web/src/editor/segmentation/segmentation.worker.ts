/// <reference lib="webworker" />
import { pipeline, RawImage, type DeviceType, type ProgressInfo } from '@huggingface/transformers'
import { logger } from '../../logger'
import { extractAlphaChannel, fitWithin } from './alpha'
import type { ModelLoadProgress, SegmentationRequest, SegmentationResponse } from './types'

declare const self: DedicatedWorkerGlobalScope

const log = logger.forContext('segmentation.worker')

/** IS-Net, Apache-2.0. Swappable for `onnx-community/BiRefNet_lite` later. */
const MODEL_ID = 'onnx-community/ormbg-ONNX'

type BackgroundRemover = Awaited<ReturnType<typeof pipeline<'background-removal'>>>

/**
 * The in-flight *or* resolved pipeline. Caching the promise rather than the
 * resolved value is what makes concurrent requests share a single download: two
 * messages arriving back-to-back would both see a `null` pipeline and each start
 * their own multi-megabyte load.
 */
let removerPromise: Promise<BackgroundRemover> | null = null

/** The slice of WebGPU we probe. `@webgpu/types` is not a dependency. */
interface GpuNavigator {
  readonly gpu?: { requestAdapter(): Promise<unknown> }
}

/**
 * Picks the fastest backend actually available. `navigator.gpu` merely says the
 * browser knows the API, not that a usable adapter exists — only requesting one
 * answers that.
 */
async function pickDevice(): Promise<DeviceType> {
  try {
    const gpu = (navigator as Navigator & GpuNavigator).gpu
    if (gpu === undefined) return 'wasm'
    const adapter = await gpu.requestAdapter()
    return adapter === null || adapter === undefined ? 'wasm' : 'webgpu'
  } catch (error) {
    log.error('WebGPU adapter probe failed; falling back to WASM', error)
    return 'wasm'
  }
}

/** Broadcasts model-load progress to the main thread. */
function postProgress(message: ModelLoadProgress): void {
  self.postMessage(message)
}

/**
 * Translates transformers.js' load events into our own progress messages.
 *
 * Only two of its six statuses matter here: `progress_total` already aggregates
 * every file into one 0..100 number (the per-file `progress` events would just
 * make the caller do that sum itself), and `ready` marks the moment the wait
 * stops being a download and starts being inference.
 */
function onLoadProgress(info: ProgressInfo): void {
  if (info.status === 'progress_total') {
    postProgress({
      kind: 'model-progress',
      phase: 'downloading',
      progress: info.progress,
      loaded: info.loaded,
      total: info.total,
    })
  } else if (info.status === 'ready') {
    postProgress({ kind: 'model-progress', phase: 'ready' })
  }
}

/**
 * Downloads and compiles the model. Expensive (tens of MB over the network on a
 * cold cache) — call through {@link ensurePipeline}, never directly.
 */
async function loadPipeline(): Promise<BackgroundRemover> {
  try {
    const device = await pickDevice()
    log.info(`Loading ${MODEL_ID} on ${device}`)
    const started = performance.now()
    const remover = await loadOn(device)
    log.info(`${MODEL_ID} ready in ${Math.round(performance.now() - started)}ms`)
    return remover
  } catch (error) {
    log.error(`Could not load ${MODEL_ID}`, error)
    // The main thread would otherwise sit on a progress bar that never moves.
    postProgress({ kind: 'model-progress', phase: 'ready' })
    throw error
  }
}

/** Builds the pipeline on `device`, falling back to WASM if the backend fails. */
async function loadOn(device: DeviceType): Promise<BackgroundRemover> {
  try {
    return await pipeline('background-removal', MODEL_ID, {
      device,
      progress_callback: onLoadProgress,
    })
  } catch (error) {
    if (device === 'wasm') throw error
    // The adapter existed but the backend still failed (driver, OOM, a missing
    // shader feature…). WASM is slower but works everywhere.
    log.error(`The ${device} backend failed; retrying on WASM`, error)
    return await pipeline('background-removal', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: onLoadProgress,
    })
  }
}

/**
 * Resolves the background-removal pipeline, loading it lazily on first use and
 * reusing it forever after. A failed load is *not* cached, so a request that
 * dies on a flaky network can be retried.
 *
 * @returns The ready-to-call pipeline.
 */
async function ensurePipeline(): Promise<BackgroundRemover> {
  try {
    if (removerPromise === null) {
      const attempt = loadPipeline()
      removerPromise = attempt
      attempt.catch(() => {
        if (removerPromise === attempt) removerPromise = null
      })
    }
    return await removerPromise
  } catch (error) {
    log.error('Segmentation pipeline unavailable', error)
    throw error
  }
}

/**
 * Runs one segmentation. Always consumes `request.bitmap`, whatever the outcome.
 *
 * @param request - The job posted by the provider.
 * @returns The response to post back — never throws.
 */
async function handleRequest(request: SegmentationRequest): Promise<SegmentationResponse> {
  const { id, bitmap } = request
  try {
    const remover = await ensurePipeline()

    // Downscale first: the pipeline echoes the mask back at input resolution.
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('Could not get a 2D context from the OffscreenCanvas')
    }
    context.drawImage(bitmap, 0, 0, width, height)

    const started = performance.now()
    const output = await remover(RawImage.fromCanvas(canvas))
    log.info(`Request ${id} inferred in ${Math.round(performance.now() - started)}ms`)
    const image = Array.isArray(output) ? output[0] : output
    const alpha = extractAlphaChannel(image)
    return { kind: 'result', id, ok: true, ...alpha }
  } catch (error) {
    log.error(`Segmentation request ${id} failed`, error)
    return {
      kind: 'result',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    // The bitmap was transferred to us; nobody else can free it.
    bitmap.close()
  }
}

self.onmessage = (event: MessageEvent<SegmentationRequest>): void => {
  void handleRequest(event.data).then((response) => {
    if (response.ok) {
      // Transfer the weight map: it is the whole payload, and copying a
      // megapixel of it per mask is pure waste.
      self.postMessage(response, [response.data.buffer])
    } else {
      self.postMessage(response)
    }
  })
}
