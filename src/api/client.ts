import type {
  OperatorInfo,
  OperatorState,
  PauseResponse,
  SelectResponse,
} from './types'

// Empty base = relative paths, which is what you want behind the dev proxy or
// when this build is served by the policy server itself. An absolute base is
// cross-origin and needs the server's --cors-origin.
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export const apiBase = BASE || '(same origin)'

const url = (path: string) => `${BASE}${path}`

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), init)
  if (!res.ok) {
    throw new Error(`${path} responded ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return json<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const getInfo = () => json<OperatorInfo>('/operator/info')

export const getState = () => json<OperatorState>('/operator/state')

/** Cache-busted so the browser re-fetches rather than serving a stale frame. */
export const frameUrl = () => url(`/operator/frame?ts=${Date.now()}`)

/**
 * Commit to a mode. `menuEpoch` must be the epoch the operator was looking at —
 * the server rejects a mismatch as `stale_epoch` instead of applying the pick to
 * a menu that has since been replaced.
 */
export const selectMode = (modeId: number, menuEpoch: number) =>
  post<SelectResponse>('/operator/select', {
    mode_id: modeId,
    menu_epoch: menuEpoch,
  })

export const setPaused = (paused: boolean) =>
  post<PauseResponse>('/operator/pause', { paused })
