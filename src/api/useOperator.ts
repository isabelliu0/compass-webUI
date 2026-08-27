import { useCallback, useEffect, useRef, useState } from 'react'

import { getInfo, getState, selectMode, setPaused } from './client'
import type { OperatorInfo, OperatorState, SelectStatus } from './types'

const STATE_POLL_MS = 200

export interface OperatorConnection {
  info: OperatorInfo | null
  state: OperatorState | null
  /** Locally interpolated countdown, so the bar is smooth between polls. */
  remaining: number | null
  connected: boolean
  error: string | null
  /** Last select result, for surfacing `stale_epoch` and friends. */
  lastSelect: { modeId: number; status: SelectStatus } | null
  choose: (modeId: number) => Promise<void>
  togglePause: () => Promise<void>
}

export function useOperator(): OperatorConnection {
  const [info, setInfo] = useState<OperatorInfo | null>(null)
  const [state, setState] = useState<OperatorState | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSelect, setLastSelect] =
    useState<{ modeId: number; status: SelectStatus } | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Anchor for interpolating the countdown: the server value plus the clock
  // reading when it arrived.
  const deadline = useRef<{ at: number; value: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getInfo()
        .then((i) => !cancelled && setInfo(i))
        .catch(() => {
          if (!cancelled) window.setTimeout(load, 2000)
        })
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // One poll in flight at a time: a slow response must not queue up behind
  // itself, which is what a bare setInterval would do.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const s = await getState()
        if (cancelled) return
        setState(s)
        setConnected(true)
        setError(null)
        deadline.current =
          s.decide_remaining_s == null
            ? null
            : { at: performance.now(), value: s.decide_remaining_s }
      } catch (e) {
        if (cancelled) return
        setConnected(false)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, STATE_POLL_MS)
      }
    }

    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const step = () => {
      const d = deadline.current
      setRemaining(
        d ? Math.max(0, d.value - (performance.now() - d.at) / 1000) : null,
      )
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  const choose = useCallback(
    async (modeId: number) => {
      if (!state) return
      try {
        const r = await selectMode(modeId, state.menu_epoch)
        setLastSelect({ modeId, status: r.status })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [state],
  )

  const togglePause = useCallback(async () => {
    if (!state) return
    try {
      await setPaused(state.phase !== 'paused')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [state])

  return { info, state, remaining, connected, error, lastSelect, choose, togglePause }
}
