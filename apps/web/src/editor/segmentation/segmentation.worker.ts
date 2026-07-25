/// <reference lib="webworker" />
import {
  AutoProcessor,
  pipeline,
  RawImage,
  SamModel,
  type DeviceType,
  type ProgressInfo,
  type Tensor,
} from '@huggingface/transformers'
import { logger } from '../../logger'
import { chooseMaskIndex, extractAlphaChannel, fitWithin, maskPixelCounts, maskToAlpha } from './alpha'
import { buildPromptArrays } from './prompt'
import type { SamPromptArrays } from './prompt'
import type {
  EmbedResponse,
  ModelLoadProgress,
  SegmentationRequest,
  SegmentationResponse,
} from './types'

declare const self: DedicatedWorkerGlobalScope

const log = logger.forContext('segmentation.worker')

/** IS-Net, Apache-2.0. Swappable for `onnx-community/BiRefNet_lite` later. */
const MODEL_ID = 'onnx-community/ormbg-ONNX'

/**
 * SlimSAM — the promptable object model, as used by the official transformers.js
 * "Segment Anything" demo. Small enough for the browser. SAM/MobileSAM/SlimSAM
 * are Apache-2.0; verify this exact weights repo's license before shipping.
 */
const SAM_MODEL_ID = 'Xenova/slimsam-77-uniform'

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
 *
 * Shared by both models: at most one is loading at a time in practice, and the
 * main thread only shows a single, global progress bar anyway.
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

// ---------------------------------------------------------------------------
// Subject — the `background-removal` pipeline (ormbg).
// ---------------------------------------------------------------------------

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
 * Runs one background removal. Always consumes `request.bitmap`, whatever the
 * outcome.
 *
 * @param request - The `segment` job posted by the provider.
 * @returns The response to post back — never throws.
 */
async function handleSegment(
  request: Extract<SegmentationRequest, { op: 'segment' }>,
): Promise<SegmentationResponse> {
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

// ---------------------------------------------------------------------------
// Object — SAM, promptable (embed once, decode per prompt).
// ---------------------------------------------------------------------------

/** Structural view of the SAM processor output we consume (no `any`). */
interface SamInputs {
  pixel_values: Tensor
  original_sizes: [number, number][]
  reshaped_input_sizes: [number, number][]
  input_points?: Tensor
  input_labels?: Tensor
  input_boxes?: Tensor
}

/** The image encoder's output — the expensive part we cache per image. */
interface SamEmbeddings {
  image_embeddings: Tensor
  image_positional_embeddings: Tensor
}

/** The mask decoder's output we consume. */
interface SamOutputs {
  pred_masks: Tensor
  iou_scores: Tensor
}

/** The subset of `SamProcessor` we call — it is callable *and* has methods. */
interface SamProcessorLike {
  (image: RawImage, options?: SamPromptArrays): Promise<SamInputs>
  post_process_masks(
    masks: Tensor,
    originalSizes: [number, number][],
    reshapedInputSizes: [number, number][],
  ): Promise<Tensor[]>
}

/** The subset of `SamModel` we call. Callable via its `_call`. */
interface SamModelLike {
  (
    inputs: SamEmbeddings & {
      input_points?: Tensor
      input_labels?: Tensor
      input_boxes?: Tensor
    },
  ): Promise<SamOutputs>
  get_image_embeddings(inputs: { pixel_values: Tensor }): Promise<SamEmbeddings>
}

interface SamBundle {
  model: SamModelLike
  processor: SamProcessorLike
}

/** The encoder output cached for one image, so re-prompting skips the encoder. */
interface EmbeddedImage {
  imageId: number
  embeddings: SamEmbeddings
  rawImage: RawImage
  /** The downscaled dimensions actually fed to the model. */
  width: number
  height: number
}

let samPromise: Promise<SamBundle> | null = null

/** The most recently embedded image. `decode` reuses it when `imageId` matches. */
let embedded: EmbeddedImage | null = null

/** Loads the SAM model on `device`, falling back to WASM if the backend fails. */
async function loadSamModel(device: DeviceType): Promise<SamModelLike> {
  try {
    return (await SamModel.from_pretrained(SAM_MODEL_ID, {
      device,
      progress_callback: onLoadProgress,
    })) as unknown as SamModelLike
  } catch (error) {
    if (device === 'wasm') throw error
    log.error(`The ${device} backend failed for SAM; retrying on WASM`, error)
    return (await SamModel.from_pretrained(SAM_MODEL_ID, {
      device: 'wasm',
      progress_callback: onLoadProgress,
    })) as unknown as SamModelLike
  }
}

/** Downloads and compiles SAM. Call through {@link ensureSam}, never directly. */
async function loadSam(): Promise<SamBundle> {
  try {
    const device = await pickDevice()
    log.info(`Loading ${SAM_MODEL_ID} on ${device}`)
    const started = performance.now()
    const [model, processor] = await Promise.all([
      loadSamModel(device),
      AutoProcessor.from_pretrained(SAM_MODEL_ID, {
        progress_callback: onLoadProgress,
      }) as unknown as Promise<SamProcessorLike>,
    ])
    log.info(`${SAM_MODEL_ID} ready in ${Math.round(performance.now() - started)}ms`)
    return { model, processor }
  } catch (error) {
    log.error(`Could not load ${SAM_MODEL_ID}`, error)
    postProgress({ kind: 'model-progress', phase: 'ready' })
    throw error
  }
}

/** Resolves the SAM bundle, loading it lazily; a failed load is not cached. */
async function ensureSam(): Promise<SamBundle> {
  try {
    if (samPromise === null) {
      const attempt = loadSam()
      samPromise = attempt
      attempt.catch(() => {
        if (samPromise === attempt) samPromise = null
      })
    }
    return await samPromise
  } catch (error) {
    log.error('SAM unavailable', error)
    throw error
  }
}

/**
 * SAM stage 1: runs the image encoder once and caches its embedding under
 * `imageId`. Always consumes `request.bitmap`.
 *
 * @param request - The `embed` job posted by the provider.
 * @returns An acknowledgement — never throws.
 */
async function handleEmbed(
  request: Extract<SegmentationRequest, { op: 'embed' }>,
): Promise<EmbedResponse> {
  const { id, imageId, bitmap } = request
  try {
    const { model, processor } = await ensureSam()

    // Downscale like Subject: the mask decoder returns at input resolution, and
    // the shader stretches a small alpha to the image for free.
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('Could not get a 2D context from the OffscreenCanvas')
    }
    context.drawImage(bitmap, 0, 0, width, height)
    const rawImage = RawImage.fromCanvas(canvas)

    const started = performance.now()
    const inputs = await processor(rawImage)
    const embeddings = await model.get_image_embeddings({ pixel_values: inputs.pixel_values })
    log.info(`Embed ${id} computed in ${Math.round(performance.now() - started)}ms`)

    // Keep the RawImage: `decode` re-runs the (cheap) processor on it to reshape
    // each prompt, without recomputing the (expensive) embedding above.
    embedded = { imageId, embeddings, rawImage, width, height }
    return { kind: 'embedded', id, imageId, ok: true }
  } catch (error) {
    log.error(`Embed request ${id} failed`, error)
    return {
      kind: 'embedded',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    bitmap.close()
  }
}

/**
 * SAM stage 2: runs the mask decoder against the cached embedding for a prompt.
 *
 * @param request - The `decode` job posted by the provider.
 * @returns The mask alpha, or a failure if the image was never embedded (the
 * main thread must then re-embed) or the prompt was empty — never throws.
 */
async function handleDecode(
  request: Extract<SegmentationRequest, { op: 'decode' }>,
): Promise<SegmentationResponse> {
  const { id, imageId, prompt } = request
  try {
    if (embedded === null || embedded.imageId !== imageId) {
      throw new Error('No cached embedding for this image; re-embed required')
    }
    if (prompt.points.length === 0 && prompt.box === null) {
      throw new Error('Empty prompt: at least one point or a box is required')
    }
    const { model, processor } = await ensureSam()
    const { rawImage, width, height, embeddings } = embedded

    // Scale the normalised prompt to the pixels of the image we fed SAM.
    const options = buildPromptArrays(prompt, width, height)

    const started = performance.now()
    const inputs = await processor(rawImage, options)
    const outputs = await model({
      ...embeddings,
      input_points: inputs.input_points,
      input_labels: inputs.input_labels,
      input_boxes: inputs.input_boxes,
    })
    const masks = await processor.post_process_masks(
      outputs.pred_masks,
      inputs.original_sizes,
      inputs.reshaped_input_sizes,
    )
    log.info(`Decode ${id} inferred in ${Math.round(performance.now() - started)}ms`)

    // masks[0].dims = [1, numMasks, height, width], boolean data (0/1).
    const maskTensor = masks[0]
    const candidates = maskTensor.dims[1]
    const maskHeight = maskTensor.dims[2]
    const maskWidth = maskTensor.dims[3]
    const scores = outputs.iou_scores.data as unknown as Float32Array
    const data = maskTensor.data as unknown as Uint8Array
    const pixels = maskPixelCounts(data, candidates, maskWidth * maskHeight)
    // One point with no box is the ambiguous case SAM's three answers exist for.
    const ambiguous = prompt.points.length <= 1 && prompt.box === null
    const index = chooseMaskIndex(scores, pixels, ambiguous, prompt.granularity)
    // The numbers behind the choice: which reading of the click was kept, and
    // how close the runners-up were. Tuning the selection blind is guesswork —
    // and the pixel count is what tells a small detail from an empty mask, which
    // a percentage of the frame rounds away.
    log.info(
      `Decode ${id} candidates: ` +
      pixels.map((count, i) =>
        `#${i} score ${scores[i].toFixed(3)} ${count}px (${((count / (maskWidth * maskHeight)) * 100).toFixed(3)}%)`,
      ).join(', ') +
      ` → #${index} (${prompt.granularity ?? 'auto'}${ambiguous ? ', ambiguous prompt' : ''})`,
    )
    const alpha = maskToAlpha(data, index, maskWidth, maskHeight)
    return { kind: 'result', id, ok: true, ...alpha }
  } catch (error) {
    log.error(`Decode request ${id} failed`, error)
    return {
      kind: 'result',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

self.onmessage = (event: MessageEvent<SegmentationRequest>): void => {
  const request = event.data
  const work: Promise<SegmentationResponse | EmbedResponse> =
    request.op === 'segment'
      ? handleSegment(request)
      : request.op === 'embed'
        ? handleEmbed(request)
        : handleDecode(request)

  void work.then((response) => {
    // Only a successful mask carries a transferable buffer; everything else
    // (failures, embed acks) is a plain structured-clone post.
    if (response.kind === 'result' && response.ok) {
      self.postMessage(response, [response.data.buffer])
    } else {
      self.postMessage(response)
    }
  })
}
