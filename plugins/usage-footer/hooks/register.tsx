import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Snapshot } from '../types'
import { segments } from './format'

const snapshot = atom({ plugin: 'usage-footer', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-footer', key: 'now' } as const, 0)

const toSnapshot = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Snapshot => {
  const fiveHour = rateLimits.find(r => r.kind === 'five_hour')

  return {
    contextTokens: context.tokens ?? null,
    contextPercent: context.percent ?? null,
    fiveHourPercent: fiveHour?.percentUsed ?? null,
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
  }
}

// Commands that change the context without a response: `estimate` counts the
// conversation locally, `rescale` keeps the size and measures it against the
// model's window.
const RECOUNTS: Record<string, Recount> = { clear: 'estimate', rewind: 'estimate', resume: 'estimate', model: 'rescale' }

type Recount = 'estimate' | 'rescale'

const recount = async ($: EngineInterface, kind: Recount) => {
  const { context } = await $.session.usage(kind === 'estimate' ? { breakdown: 'summary' } : undefined)

  await update($, snapshot, s => {
    const base = s ?? toSnapshot(context, [])
    const tokens = kind === 'estimate' ? (context.breakdown?.totalTokens ?? base.contextTokens) : base.contextTokens

    return {
      ...base,
      contextTokens: tokens,
      contextPercent: tokens === null ? null : Math.round((tokens / context.window) * 100),
    }
  })
}

export const register: Register = on => {
  // The recount a command asked for, repeated on each tick until a response
  // reports the size: a command that opens a picker changes the context later.
  let pending: Recount | null = null
  // The engine's latest reading, and a reading of a conversation that a
  // compaction or a command replaced: the engine repeats it until a response.
  let lastReading: number | undefined
  let stale: number | undefined

  // A session has no reading until its first response, so the footer shows
  // the local count of the conversation it starts with.
  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage({ breakdown: 'summary' })
    lastReading = usage.context.tokens
    await update($, snapshot, () => {
      const read = toSnapshot(usage.context, usage.rateLimits)
      const tokens = read.contextTokens ?? usage.context.breakdown?.totalTokens ?? null
      const percent = tokens === null ? null : Math.round((tokens / usage.context.window) * 100)

      return { ...read, contextTokens: tokens, contextPercent: read.contextPercent ?? percent }
    })
    await $.clock.now().then(t => update($, now, () => t))
    $.clock.every(30_000, () => {
      void $.clock.now().then(t => update($, now, () => t))

      if (pending !== null) {
        void recount($, pending)
      }
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const reading = e.context.tokens
    const isStale = reading === undefined || reading === stale
    const t = await $.clock.now()

    await update($, snapshot, s => {
      const read = toSnapshot(e.context, e.rateLimits)
      // A reading with no 5-hour window, as after /clear, keeps the last one
      // until that window resets: the window belongs to the account.
      const isKept =
        read.fiveHourPercent === null && s?.fiveHourResetsAt != null && new Date(s.fiveHourResetsAt).getTime() > t
      const fresh = isKept ? { ...read, fiveHourPercent: s.fiveHourPercent, fiveHourResetsAt: s.fiveHourResetsAt } : read

      // Until the first response on the new conversation, keep the size the
      // compaction or the recount reported.
      return isStale && s !== null ? { ...fresh, contextTokens: s.contextTokens, contextPercent: s.contextPercent } : fresh
    })
    await update($, now, () => t)

    if (!isStale) {
      pending = null
      stale = undefined
    }

    lastReading = reading ?? lastReading

    return next(e)
  })

  on('command.run', async ($, e, next) => {
    const result = await next(e)
    const kind = RECOUNTS[e.command]

    if (kind !== undefined) {
      pending = kind
      stale = kind === 'estimate' ? lastReading : stale
      await recount($, kind)
      $.clock.after(3_000, () => void recount($, kind))
    }

    return result
  })

  // A compacted conversation has no reading until its next response, so the
  // footer shows the size the compaction reports.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    if (e.trigger === 'precompute' || e.agentId !== undefined || result.messages === undefined) {
      return result
    }

    stale = lastReading
    const { context } = await $.session.usage()
    const tokens = result.tokensAfter ?? null
    await update($, snapshot, s => ({
      ...(s ?? toSnapshot(context, [])),
      contextTokens: tokens,
      contextPercent: tokens === null ? null : Math.round((tokens / context.window) * 100),
    }))

    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const s = await read($, snapshot)

    if (s === null) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)
    const modes = e.props.modes.length > 0 ? `${e.props.modes.join(' & ')} ┊ ` : ''

    return (
      <Text>
        <Text dimColor>{modes}</Text>
        {segments(s, await read($, now)).map(p => (
          <Text color={p.tone} bold={p.isBold} dimColor={p.isDim}>
            {p.text}
          </Text>
        ))}
      </Text>
    )
  })
}
