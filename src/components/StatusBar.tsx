import type { OperatorInfo, OperatorState, SelectStatus } from '../api/types'

const SELECT_MESSAGE: Record<SelectStatus, string> = {
  ok: 'selected',
  stale_epoch: 'the menu changed before that landed — pick again',
  out_of_range: 'that mode is not in the current menu',
  no_menu: 'no modes on offer right now',
  menu_not_ready: 'the menu is still being sampled',
  disabled: 'this server was started without --mode-preview',
}

const HAND = ['left', 'right']

/** What the robot is asking about, in words. */
function asked(state: OperatorState): string {
  const d = state.decision
  if (!d) return 'a decision point'
  switch (d.kind) {
    case 'initial':
      return 'how to start'
    case 'gripper': {
      const which = d.hands.map((h) => HAND[h] ?? `arm ${h}`).join(' and ')
      return which ? `what the ${which} hand should grasp or release` : 'a grasp or release'
    }
    case 'inter_hand':
      return 'how the two hands should move relative to each other'
    case 'static':
      return 'where to go next, now both arms have settled'
    // Only reachable as a mode's own outcome, not as a hold; handled for completeness.
    case 'none':
      return 'what to do next'
  }
}

function hint(state: OperatorState | null, untimed: boolean): string {
  if (!state) return 'connecting to the policy server…'
  switch (state.phase) {
    case 'idle':
      return 'waiting for the robot client to start streaming to /predict'
    case 'paused':
      return 'held by the operator'
    case 'executing':
      return state.mode_follow_active
        ? `executing mode ${state.selected_mode_id}, mode-follow steering it`
        : `executing mode ${state.selected_mode_id} (follow reference exhausted)`
    case 'initial_pause':
    case 'pause_gripper_event':
    case 'pause_ihtf_event':
      if (!state.menu_ready) return 'decision point reached; sampling options…'
      return untimed
        ? `deciding ${asked(state)} — the robot waits until you pick one`
        : `deciding ${asked(state)} — pick an option, or mode ${state.selected_mode_id} rolls out when the timer expires`
  }
}

interface Props {
  info: OperatorInfo | null
  state: OperatorState | null
  remaining: number | null
  connected: boolean
  error: string | null
  lastSelect: { modeId: number; status: SelectStatus } | null
  onTogglePause: () => void
}

export function StatusBar({
  info,
  state,
  remaining,
  connected,
  error,
  lastSelect,
  onTogglePause,
}: Props) {
  const phase = state?.phase ?? 'idle'
  const paused = phase === 'paused'
  const phaseLabel = phase.replace(/_/g, ' ')
  // null timeout = untimed: there is no deadline, so showing a countdown would imply
  // a pressure that doesn't exist.
  const untimed = info != null && info.decide_timeout_s == null
  const timeout = info?.decide_timeout_s || 5
  const pct = remaining == null ? 0 : Math.min(100, (100 * remaining) / timeout)
  const deciding =
    phase === 'initial_pause' ||
    phase === 'pause_gripper_event' ||
    phase === 'pause_ihtf_event'

  return (
    <>
      <header>
        <span className={`phase ${phase}`}>{phaseLabel}</span>

        {untimed ? (
          <span className="pill">
            <label>decide</label>
            <b>{deciding ? 'waiting for you' : 'untimed'}</b>
          </span>
        ) : (
          <span className="pill">
            <label>decide</label>
            <span className="bar">
              <i style={{ width: `${pct.toFixed(0)}%` }} />
            </span>
            <b>{remaining == null ? '--' : `${remaining.toFixed(1)}s`}</b>
          </span>
        )}

        <span className="pill">
          epoch <b>{state?.menu_epoch ?? '-'}</b>
          {state && !state.menu_ready && <em>computing</em>}
        </span>
        <span className="pill">
          selected <b>{state?.selected_mode_id ?? '-'}</b>
        </span>
        <span className="pill">
          follow <b>{state?.mode_follow_active ? 'on' : 'off'}</b>
        </span>

        <button
          type="button"
          className={paused ? 'pause on' : 'pause'}
          onClick={onTogglePause}
          disabled={!state}
        >
          {paused ? 'resume' : 'pause'}
        </button>

        <span className={`link ${connected ? 'up' : 'down'}`}>
          {connected ? 'connected' : 'no server'}
        </span>
      </header>

      <div className="status">
        {hint(state, untimed)}
        {lastSelect && (
          <span className={lastSelect.status === 'ok' ? 'ok' : 'warn'}>
            mode {lastSelect.modeId}: {SELECT_MESSAGE[lastSelect.status]}
          </span>
        )}
        {error && <span className="warn">{error}</span>}
      </div>
    </>
  )
}
