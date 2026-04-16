/**
 * Per-process rate-limit + concurrency gate for the public report API.
 *
 * The landing-page report flow is public, so we have to assume
 * spiders / bad actors / genuine curiosity bursts will all hit it at
 * once. Two guardrails:
 *
 *   1. Concurrency gate — at most `MAX_CONCURRENT` reports render in
 *      parallel. Additional callers wait in a small in-memory queue.
 *      If the queue exceeds `MAX_QUEUE`, callers get a clear 503 and
 *      the UI shows "please wait, we're thanking you for your
 *      patience…" while polling for a retry slot.
 *
 *   2. Per-IP rate cap — at most `IP_CAP_PER_HOUR` successful
 *      generations per IP per rolling hour. Leads us toward "any user
 *      can download a sample report" (the user's words) while still
 *      preventing a single IP from pulling hundreds of reports.
 *
 * This is a best-effort soft limiter — Next.js serverless can
 * horizontally scale and the Map lives in a single process, so treat
 * the counts as a floor rather than a strict ceiling. For the
 * landing-page flow that's enough: abusers get slowed but real users
 * are never blocked.
 */

const MAX_CONCURRENT = 3
const MAX_QUEUE = 20
const IP_CAP_PER_HOUR = 10
const HOUR_MS = 60 * 60 * 1000

let active = 0
const waitQueue: Array<() => void> = []

interface IpCounter {
  count: number
  windowStart: number
}
const ipCounters = new Map<string, IpCounter>()

/** Reserve one concurrency slot; resolves as soon as a slot is free. */
export async function acquireSlot(): Promise<() => void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return releaseOnce()
  }
  if (waitQueue.length >= MAX_QUEUE) {
    throw new RateLimitBusyError()
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve))
  active += 1
  return releaseOnce()
}

function releaseOnce(): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    active = Math.max(0, active - 1)
    const next = waitQueue.shift()
    if (next) next()
  }
}

/** True if we're currently at the limit and the caller would have to wait. */
export function isBusy(): boolean {
  return active >= MAX_CONCURRENT
}

/** Snapshot for the client UI — pending reports ahead of me. */
export function queueDepth(): { active: number; waiting: number } {
  return { active, waiting: waitQueue.length }
}

/**
 * Per-IP counter. Returns { ok: true } if the caller is still inside
 * the hourly cap; otherwise { ok: false, resetMs } with the number of
 * milliseconds until the current window expires.
 */
export function checkIp(ip: string): { ok: true; remaining: number } | { ok: false; resetMs: number } {
  const now = Date.now()
  const cur = ipCounters.get(ip)
  if (!cur || now - cur.windowStart > HOUR_MS) {
    ipCounters.set(ip, { count: 1, windowStart: now })
    return { ok: true, remaining: IP_CAP_PER_HOUR - 1 }
  }
  if (cur.count >= IP_CAP_PER_HOUR) {
    return { ok: false, resetMs: HOUR_MS - (now - cur.windowStart) }
  }
  cur.count += 1
  return { ok: true, remaining: IP_CAP_PER_HOUR - cur.count }
}

export class RateLimitBusyError extends Error {
  constructor() {
    super('Report generation queue is full — please try again in a minute.')
    this.name = 'RateLimitBusyError'
  }
}
