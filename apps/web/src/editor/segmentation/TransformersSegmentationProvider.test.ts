import { describe, expect, it, vi } from 'vitest'
import {
  TransformersSegmentationProvider,
  type SegmentationWorker,
} from './TransformersSegmentationProvider'
import type {
  ModelLoadProgress,
  ModelPrompt,
  SegmentationRequest,
  SegmentationResponse,
  WorkerMessage,
} from './types'

/** A stand-in for the real worker: records what it is sent, replies on demand. */
class FakeWorker implements SegmentationWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: SegmentationRequest[] = []
  readonly transfers: Transferable[][] = []
  terminated = false

  postMessage(message: SegmentationRequest, transfer: Transferable[]): void {
    this.posted.push(message)
    this.transfers.push(transfer)
  }

  terminate(): void {
    this.terminated = true
  }

  /** Simulates the worker posting a message back. */
  respond(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }

  /** Simulates the worker dying (failed chunk load, OOM…). */
  crash(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

interface FakeBitmap {
  closed: boolean
}

/** jsdom has no ImageBitmap; we only need `close` and the dimensions. */
function fakeBitmap(): ImageBitmap & FakeBitmap {
  const bitmap = {
    width: 4000,
    height: 3000,
    closed: false,
    close(): void {
      bitmap.closed = true
    },
  }
  return bitmap as unknown as ImageBitmap & FakeBitmap
}

function success(id: number, data: number[]): SegmentationResponse {
  return { kind: 'result', id, ok: true, data: new Uint8Array(data), width: data.length, height: 1 }
}

/** One foreground click in the middle of the frame. */
function clickPrompt(): ModelPrompt {
  return { points: [{ x: 0.5, y: 0.5, label: 1 }], box: null }
}

describe('TransformersSegmentationProvider', () => {
  it('does not build a worker until the first segmentation', () => {
    const createWorker = vi.fn(() => new FakeWorker())
    new TransformersSegmentationProvider({ createWorker })
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('builds the worker once and reuses it across calls', async () => {
    const worker = new FakeWorker()
    const createWorker = vi.fn(() => worker)
    const provider = new TransformersSegmentationProvider({ createWorker })

    const first = provider.segment(fakeBitmap(), 'subject')
    const second = provider.segment(fakeBitmap(), 'subject')
    worker.respond(success(0, [1]))
    worker.respond(success(1, [2]))
    await Promise.all([first, second])

    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('resolves with the weight map sent by the worker', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const result = provider.segment(fakeBitmap(), 'subject')
    worker.respond({ kind: 'result', id: 0, ok: true, data: new Uint8Array([0, 255]), width: 2, height: 1 })

    await expect(result).resolves.toEqual({
      data: new Uint8Array([0, 255]),
      width: 2,
      height: 1,
    })
  })

  it('transfers the bitmap instead of copying it', () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })
    const bitmap = fakeBitmap()

    void provider.segment(bitmap, 'subject')

    const posted = worker.posted[0]
    expect(posted.op).toBe('segment')
    // Narrow the request union: `decode` carries no bitmap.
    if (posted.op === 'decode') throw new Error('expected a segment request')
    expect(posted.bitmap).toBe(bitmap)
    expect(worker.transfers[0]).toEqual([bitmap])
  })

  it('keeps concurrent requests apart when they answer out of order', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const first = provider.segment(fakeBitmap(), 'subject')
    const second = provider.segment(fakeBitmap(), 'subject')
    // The second job finishes first — its id must still route to its caller.
    worker.respond(success(1, [22]))
    worker.respond(success(0, [11]))

    await expect(first).resolves.toMatchObject({ data: new Uint8Array([11]) })
    await expect(second).resolves.toMatchObject({ data: new Uint8Array([22]) })
  })

  it('rejects with the message the worker reported', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const result = provider.segment(fakeBitmap(), 'subject')
    worker.respond({ kind: 'result', id: 0, ok: false, error: 'model download failed' })

    await expect(result).rejects.toThrow('model download failed')
  })

  it('rejects sky without building a worker, since ormbg cannot segment it', async () => {
    const createWorker = vi.fn(() => new FakeWorker())
    const provider = new TransformersSegmentationProvider({ createWorker })
    const bitmap = fakeBitmap()

    await expect(provider.segment(bitmap, 'sky')).rejects.toThrow(/not implemented/)
    expect(createWorker).not.toHaveBeenCalled()
    expect(bitmap.closed).toBe(true)
  })

  it('fails every in-flight job when the worker crashes', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const first = provider.segment(fakeBitmap(), 'subject')
    const second = provider.segment(fakeBitmap(), 'subject')
    worker.crash('Failed to fetch the worker chunk')

    await expect(first).rejects.toThrow('Failed to fetch the worker chunk')
    await expect(second).rejects.toThrow('Failed to fetch the worker chunk')
  })

  it('reports a crash with no message rather than an empty error', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const result = provider.segment(fakeBitmap(), 'subject')
    worker.crash('')

    await expect(result).rejects.toThrow('Segmentation worker crashed')
  })

  it('terminates the worker and rejects pending jobs on dispose', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const result = provider.segment(fakeBitmap(), 'subject')
    provider.dispose()

    await expect(result).rejects.toThrow(/disposed/)
    expect(worker.terminated).toBe(true)
  })

  it('disposes cleanly when no worker was ever built', () => {
    const createWorker = vi.fn(() => new FakeWorker())
    const provider = new TransformersSegmentationProvider({ createWorker })

    expect(() => {
      provider.dispose()
      provider.dispose()
    }).not.toThrow()
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('rejects and releases the bitmap when used after dispose', async () => {
    const provider = new TransformersSegmentationProvider({ createWorker: () => new FakeWorker() })
    provider.dispose()
    const bitmap = fakeBitmap()

    await expect(provider.segment(bitmap, 'subject')).rejects.toThrow(/disposed/)
    expect(bitmap.closed).toBe(true)
  })

  it('ignores a late response for a job that is already gone', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const result = provider.segment(fakeBitmap(), 'subject')
    worker.respond(success(0, [1]))
    await result

    expect(() => worker.respond(success(0, [1]))).not.toThrow()
  })

  it('forwards model-load progress without settling any job', async () => {
    const worker = new FakeWorker()
    const seen: ModelLoadProgress[] = []
    const provider = new TransformersSegmentationProvider({
      createWorker: () => worker,
      onModelProgress: (progress) => seen.push(progress),
    })

    const result = provider.segment(fakeBitmap(), 'subject')
    worker.respond({ kind: 'model-progress', phase: 'downloading', progress: 42, loaded: 42, total: 100 })
    worker.respond({ kind: 'model-progress', phase: 'ready' })
    // The job is still open: progress is not an answer.
    worker.respond(success(0, [7]))

    await expect(result).resolves.toMatchObject({ data: new Uint8Array([7]) })
    expect(seen).toEqual([
      { kind: 'model-progress', phase: 'downloading', progress: 42, loaded: 42, total: 100 },
      { kind: 'model-progress', phase: 'ready' },
    ])
  })

  it('survives progress messages when no listener was given', async () => {
    const worker = new FakeWorker()
    const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

    const result = provider.segment(fakeBitmap(), 'subject')
    expect(() => {
      worker.respond({ kind: 'model-progress', phase: 'ready' })
    }).not.toThrow()
    worker.respond(success(0, [1]))

    await expect(result).resolves.toMatchObject({ width: 1 })
  })

  it('releases the bitmap when the worker cannot even be built', async () => {
    const provider = new TransformersSegmentationProvider({
      createWorker: () => {
        throw new Error('Worker constructor unavailable')
      },
    })
    const bitmap = fakeBitmap()

    await expect(provider.segment(bitmap, 'subject')).rejects.toThrow(
      'Worker constructor unavailable',
    )
    expect(bitmap.closed).toBe(true)
  })

  describe('segmentObject', () => {
    /**
     * Lets the microtasks between the embed acknowledgement and the decode that
     * follows it run — `segmentObject` chains the two, so the second request is
     * only posted a tick after the first is answered.
     */
    function flush(): Promise<void> {
      return new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    }

    /** Answers an `embed` posted at `id`, then lets its decode be dispatched. */
    async function acknowledgeEmbed(worker: FakeWorker, id: number): Promise<void> {
      worker.respond({ kind: 'embedded', id, imageId: 7, ok: true })
      await flush()
    }

    it('encodes the image first, then decodes the prompt', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const result = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      expect(worker.posted[0]).toMatchObject({ op: 'embed', id: 0, imageId: 7 })

      await acknowledgeEmbed(worker, 0)
      expect(worker.posted[1]).toMatchObject({ op: 'decode', id: 1, imageId: 7 })
      worker.respond(success(1, [255]))

      await expect(result).resolves.toEqual({
        data: new Uint8Array([255]),
        width: 1,
        height: 1,
      })
    })

    it('reuses the encoding for the next prompt on the same image', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const first = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      await acknowledgeEmbed(worker, 0)
      worker.respond(success(1, [255]))
      await first

      // The second click is where the design pays off: no encoder, just a decode.
      const bitmap = fakeBitmap()
      const second = provider.segmentObject(bitmap, 7, clickPrompt())
      await flush()
      worker.respond(success(2, [128]))
      await expect(second).resolves.toMatchObject({ data: new Uint8Array([128]) })

      expect(worker.posted.filter((request) => request.op === 'embed')).toHaveLength(1)
      // Nobody else can free the clone the caller handed over.
      expect(bitmap.closed).toBe(true)
    })

    it('encodes only once when two prompts race on an unencoded image', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const first = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      const second = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      await acknowledgeEmbed(worker, 0)
      // Both decodes wait on the single embed, so they take the next two ids.
      worker.respond(success(1, [1]))
      worker.respond(success(2, [2]))
      await Promise.all([first, second])

      expect(worker.posted.filter((request) => request.op === 'embed')).toHaveLength(1)
    })

    it('re-encodes when the image changes', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const first = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      await acknowledgeEmbed(worker, 0)
      worker.respond(success(1, [1]))
      await first

      void provider.segmentObject(fakeBitmap(), 8, clickPrompt())
      expect(worker.posted[2]).toMatchObject({ op: 'embed', imageId: 8 })
    })

    it('does not remember a failed encoding as done', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const first = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      worker.respond({ kind: 'embedded', id: 0, ok: false, error: 'model download failed' })
      await expect(first).rejects.toThrow('model download failed')

      // A retry has to encode again, or every decode would be answered with
      // "re-embed required" forever.
      void provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      expect(worker.posted[1]).toMatchObject({ op: 'embed', imageId: 7 })
    })

    it('rejects with the decoder message when the prompt cannot be segmented', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const result = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      await acknowledgeEmbed(worker, 0)
      worker.respond({ kind: 'result', id: 1, ok: false, error: 'Empty prompt' })

      await expect(result).rejects.toThrow('Empty prompt')
    })

    it('transfers the bitmap for the encoding but nothing for the decoding', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })
      const bitmap = fakeBitmap()

      void provider.segmentObject(bitmap, 7, clickPrompt())
      await acknowledgeEmbed(worker, 0)

      expect(worker.transfers[0]).toEqual([bitmap])
      // The worker keeps the encoded image; a prompt is a handful of numbers.
      expect(worker.transfers[1]).toEqual([])
    })

    it('fails an in-flight encoding on dispose instead of hanging', async () => {
      const worker = new FakeWorker()
      const provider = new TransformersSegmentationProvider({ createWorker: () => worker })

      const result = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      provider.dispose()

      await expect(result).rejects.toThrow(/disposed/)
    })

    it('re-encodes after the worker dies, since the new one knows nothing', async () => {
      const worker = new FakeWorker()
      const replacement = new FakeWorker()
      let built = 0
      const provider = new TransformersSegmentationProvider({
        createWorker: () => (built++ === 0 ? worker : replacement),
      })

      const first = provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      await acknowledgeEmbed(worker, 0)
      worker.respond(success(1, [1]))
      await first
      worker.crash('out of memory')

      void provider.segmentObject(fakeBitmap(), 7, clickPrompt())
      expect(replacement.posted[0]).toMatchObject({ op: 'embed', imageId: 7 })
    })

    it('rejects and releases the bitmap when used after dispose', async () => {
      const provider = new TransformersSegmentationProvider({ createWorker: () => new FakeWorker() })
      provider.dispose()
      const bitmap = fakeBitmap()

      await expect(provider.segmentObject(bitmap, 7, clickPrompt())).rejects.toThrow(/disposed/)
      expect(bitmap.closed).toBe(true)
    })
  })
})
