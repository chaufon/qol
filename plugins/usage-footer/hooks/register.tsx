import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Snapshot } from '../types'
import { segments, sevenDay } from './format'

const snapshot = atom({ plugin: 'usage-footer', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-footer', key: 'now' } as const, 0)

const toSnapshot = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Snapshot => {
  const fiveHour = rateLimits.find(r => r.kind === 'five_hour')
  const week = rateLimits.find(r => r.kind === 'seven_day')

  return {
    contextTokens: context.tokens ?? null,
    contextPercent: context.percent ?? null,
    fiveHourPercent: fiveHour?.percentUsed ?? null,
    fiveHourResetsAt: fiveHour?.resetsAt ?? null,
    sevenDayPercent: week?.percentUsed ?? null,
    sevenDayResetsAt: week?.resetsAt ?? null,
  }
}

// A reading without a window, as after /clear, keeps the last one until that
// window resets: the windows belong to the account.
const keepWindows = (read: Snapshot, s: Snapshot | null, t: number): Snapshot => {
  const isLive = (resetsAt: string | null | undefined) => resetsAt != null && new Date(resetsAt).getTime() > t
  const fiveHour =
    read.fiveHourPercent === null && isLive(s?.fiveHourResetsAt)
      ? { fiveHourPercent: s?.fiveHourPercent ?? null, fiveHourResetsAt: s?.fiveHourResetsAt ?? null }
      : {}
  const week =
    read.sevenDayPercent === null && isLive(s?.sevenDayResetsAt)
      ? { sevenDayPercent: s?.sevenDayPercent ?? null, sevenDayResetsAt: s?.sevenDayResetsAt ?? null }
      : {}

  return { ...read, ...fiveHour, ...week }
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
      const fresh = keepWindows(toSnapshot(e.context, e.rateLimits), s, t)

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
    const stored = await read($, snapshot)

    if (stored === null) {
      return next(e)
    }

    // A snapshot stored before the mod read the 7-day window has no fields for it.
    const s: Snapshot = {
      ...stored,
      sevenDayPercent: stored.sevenDayPercent ?? null,
      sevenDayResetsAt: stored.sevenDayResetsAt ?? null,
    }
    const t = await read($, now)
    const week = sevenDay(s, t)
    const { Box, Text } = $.ui.resolve(e)
    const modes = e.props.modes.length > 0 ? `${e.props.modes.join(' & ')} ┊ ` : ''
    const draw = (parts: ReturnType<typeof segments>) =>
      parts.map(p => (
        <Text color={p.tone} bold={p.isBold} dimColor={p.isDim}>
          {p.text}
        </Text>
      ))

    // Hovering the 7-day reading reveals its reset time on the row above,
    // painted over what is there without moving it.
    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text>
          <Text dimColor>{modes}</Text>
          {draw(segments(s, t))}
        </Text>
        {week !== null && (
          <Box key="seven-day">
            <Text>{draw(week.parts)}</Text>
            {week.card !== null && (
              <Box position="absolute" top={-1} right={0} display="none" hover={{ display: 'flex' }}>
                <Text inverse>{` ${week.card} `}</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
