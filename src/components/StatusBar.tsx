import type { OperatorInfo, OperatorState, SelectStatus } from '../api/types'

const SELECT_MESSAGE: Record<SelectStatus, string> = {
  ok: 'selected',
  stale_epoch: 'the menu changed before that landed — pick again',
  out_of_range: 'that mode is not in the current menu',
  no_menu: 'no modes on offer right now',
  menu_not_ready: 'the menu is still being sampled',
  disabled: 'this server was started without --mode-preview',
}

function hint(state: OperatorState | null): string {
  if (!state) return 'connecting to the policy server…'
  switch (state.phase) {
    case 'idle':
      return 'waiting for the robot client to start streaming to /predict'
    case 'deciding':
      return state.menu_ready
        ? `decide now — pick a mode, or mode ${state.selected_mode_id} rolls out when the timer expires`
        : 'decision point reached; sampling modes…'
    case 'paused':
      return 'held by the operator'
    case 'running':
      return state.mode_follow_active
        ? `executing mode ${state.selected_mode_id}, mode-follow steering it`
        : `executing mode ${state.selected_mode_id} (follow reference exhausted)`
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
  const timeout = info?.decide_timeout_s || 5
  const pct = remaining == null ? 0 : Math.min(100, (100 * remaining) / timeout)

  return (
    <>
      <header>
        <span className={`phase ${phase}`}>{phase}</span>

        <span className="pill">
          <label>decide</label>
          <span className="bar">
            <i style={{ width: `${pct.toFixed(0)}%` }} />
          </span>
          <b>{remaining == null ? '--' : `${remaining.toFixed(1)}s`}</b>
        </span>

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
        {hint(state)}
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
