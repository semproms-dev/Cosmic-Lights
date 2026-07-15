import { describe, expect, it, vi } from 'vitest'
import {
  TransformersSegmentationProvider,
  type SegmentationWorker,
} from './TransformersSegmentationProvider'
import type {
  ModelLoadProgress,
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

    expect(worker.posted[0].bitmap).toBe(bitmap)
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
})
