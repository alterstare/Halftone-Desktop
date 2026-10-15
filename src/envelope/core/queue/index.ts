// In-process background job queue. Heavy work (import, inference, moves) runs
// here, never in an IPC handler. Jobs report progress through `onProgress`;
// a job can be cancelled while queued or (cooperatively) while running.
//
// Background jobs (e.g. comparing with learned characters) step aside: when
// any other job is added, a running background job is stopped (it must honor
// the abort signal) and queued again after it — its promise settles only when
// it finally completes.
//
// 모두 일시정지: nothing new starts; a running job that can start over
// (resumable — engine results are cached, so it picks up where it was) is
// stopped and put back first in line; one that changes files finishes. 재개
// carries on; once nothing is left the queue is no longer paused.
import type { ProgressEvent } from '../../shared/types'

export interface JobContext {
  signal: AbortSignal
  report: (done: number, total: number, label?: string, unit?: 'bytes') => void
}

export type JobFn<T> = (ctx: JobContext) => Promise<T>

interface Entry {
  id: number
  label: string
  fn: JobFn<unknown>
  ctrl: AbortController
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  background: boolean
  preempted: boolean
  resumable: boolean
  pausing: boolean // stopped by 일시정지: back first in line
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export class JobQueue {
  private seq = 0
  private waiting: Entry[] = []
  private running = new Map<number, Entry>()
  private listeners = new Set<(e: ProgressEvent) => void>()
  private paused = false

  constructor(private concurrency = 1) {}

  onProgress(cb: (e: ProgressEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(e: ProgressEvent): void {
    for (const l of this.listeners) l(e)
  }

  // Queue a job; the promise settles with its result (rejects with
  // CancelledError when cancelled).
  add<T>(label: string, fn: JobFn<T>, opts: { background?: boolean; resumable?: boolean } = {}): { id: number; done: Promise<T> } {
    const id = ++this.seq
    if (this.paused && !this.size) this.paused = false // nothing was held: a new job just runs
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const done = new Promise<T>((res, rej) => {
      resolve = res as (v: unknown) => void
      reject = rej
    })
    const background = !!opts.background
    const entry: Entry = { id, label, fn: fn as JobFn<unknown>, ctrl: new AbortController(), resolve, reject, background, preempted: false, resumable: opts.resumable !== false, pausing: false }
    if (background) this.waiting.push(entry)
    else {
      // ahead of waiting background jobs; a running one makes way
      const at = this.waiting.findIndex((w) => w.background)
      this.waiting.splice(at < 0 ? this.waiting.length : at, 0, entry)
      for (const r of this.running.values())
        if (r.background && !r.preempted) {
          r.preempted = true
          r.ctrl.abort()
        }
    }
    this.emit({ jobId: id, label, done: 0, total: 0, state: 'queued', background, paused: this.paused })
    this.pump()
    return { id, done }
  }

  get isPaused(): boolean {
    return this.paused
  }

  pauseAll(): void {
    if (!this.size) return
    this.paused = true
    for (const r of this.running.values())
      if (r.resumable && !r.pausing) {
        r.pausing = true
        r.ctrl.abort()
      }
    for (const w of this.waiting) this.emit({ jobId: w.id, label: w.label, done: 0, total: 0, state: 'queued', background: w.background, paused: true })
  }

  resumeAll(): void {
    if (!this.paused) return
    this.paused = false
    for (const w of this.waiting) this.emit({ jobId: w.id, label: w.label, done: 0, total: 0, state: 'queued', background: w.background, paused: false })
    this.pump()
  }

  cancelAll(): number {
    const ids = [...this.waiting.map((e) => e.id), ...this.running.keys()]
    for (const id of ids) this.cancel(id)
    return ids.length
  }

  cancel(id: number): boolean {
    const i = this.waiting.findIndex((e) => e.id === id)
    if (i >= 0) {
      const [e] = this.waiting.splice(i, 1)
      this.emit({ jobId: id, label: e.label, done: 0, total: 0, state: 'cancelled' })
      e.reject(new CancelledError())
      this.pump()
      return true
    }
    const r = this.running.get(id)
    if (r) {
      r.preempted = false // the user's cancel wins over "make way" / 일시정지
      r.pausing = false
      r.ctrl.abort()
      return true
    }
    return false
  }

  get size(): number {
    return this.waiting.length + this.running.size
  }

  private pump(): void {
    if (this.paused && !this.size) this.paused = false
    while (!this.paused && this.running.size < this.concurrency && this.waiting.length) {
      const e = this.waiting.shift()!
      this.running.set(e.id, e)
      void this.run(e)
    }
  }

  private async run(e: Entry): Promise<void> {
    let last: { done: number; total: number; unit?: 'bytes' } = { done: 0, total: 0 }
    const report = (done: number, total: number, label?: string, unit?: 'bytes'): void => {
      last = { done, total, unit }
      this.emit({ jobId: e.id, label: label ?? e.label, title: e.label, done, total, unit, state: 'running', background: e.background })
    }
    this.emit({ jobId: e.id, label: e.label, done: 0, total: 0, state: 'running', background: e.background })
    try {
      const v = await e.fn({ signal: e.ctrl.signal, report })
      if (e.ctrl.signal.aborted) throw new CancelledError() // stopped (or made way: runs again)
      this.emit({ jobId: e.id, label: e.label, ...last, state: 'done', background: e.background })
      e.resolve(v)
    } catch (err) {
      if (e.pausing) {
        // 일시정지: first in line again, same promise
        e.pausing = false
        e.preempted = false
        e.ctrl = new AbortController()
        this.waiting.unshift(e)
        this.emit({ jobId: e.id, label: e.label, ...last, state: 'queued', background: e.background, paused: true })
        return
      }
      if (e.preempted) {
        // made way for another job: run again later, same promise
        e.preempted = false
        e.ctrl = new AbortController()
        this.waiting.push(e)
        this.emit({ jobId: e.id, label: e.label, done: 0, total: 0, state: 'queued', background: true })
        return
      }
      const cancelled = e.ctrl.signal.aborted || err instanceof CancelledError
      this.emit({
        jobId: e.id,
        label: e.label,
        ...last,
        state: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : String((err as Error)?.message ?? err)
      })
      e.reject(cancelled ? new CancelledError() : err)
    } finally {
      this.running.delete(e.id)
      this.pump()
    }
  }
}
