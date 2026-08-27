import type { Camera, Decision, DecisionKind, Trajectory } from '../api/types'

export type Point2 = [number, number]

/**
 * Pelvis-frame metres -> pixels on a canvas `targetWidth` wide.
 *
 * The server hands out K and the extrinsic once because both are constant for a
 * run (the waist is pinned during manipulation), so every client can project
 * locally instead of asking for pixels.
 *
 * Returns null for points behind the camera; callers must drop those rather than
 * drawing them, or polylines will fold back across the frame.
 */
export function makeProjector(cam: Camera, targetWidth: number) {
  const T = cam.T_pelvis_in_optical
  const K = cam.K
  const scale = targetWidth / cam.width

  return (p: readonly number[]): Point2 | null => {
    const x = T[0][0] * p[0] + T[0][1] * p[1] + T[0][2] * p[2] + T[0][3]
    const y = T[1][0] * p[0] + T[1][1] * p[1] + T[1][2] * p[2] + T[1][3]
    const z = T[2][0] * p[0] + T[2][1] * p[1] + T[2][2] * p[2] + T[2][3]
    if (z <= 1e-6) return null
    return [
      (K[0][0] * (x / z) + K[0][2]) * scale,
      (K[1][1] * (y / z) + K[1][2]) * scale,
    ]
  }
}

/**
 * Position of one arm at `t` seconds from now.
 *
 * `trajectory.times` is NOT uniformly spaced — the policy predicts on a
 * multi-resolution grid that coarsens into the far future — so this interpolates
 * on `times` rather than indexing by row. Treating rows as evenly spaced makes
 * far-future motion appear several times too fast.
 */
export function sampleAt(
  trajectory: Trajectory,
  arm: number,
  t: number,
): number[] | null {
  const { times } = trajectory
  const pts = trajectory.points[arm]
  if (!pts?.length || !times.length) return null
  if (t <= times[0]) return pts[0]
  if (t >= times[times.length - 1]) return pts[pts.length - 1]

  let hi = 1
  while (hi < times.length && times[hi] < t) hi++
  const lo = hi - 1
  const span = times[hi] - times[lo]
  const w = span > 1e-9 ? (t - times[lo]) / span : 0
  return pts[lo].map((v, i) => v + w * (pts[hi][i] - v))
}

/** Total lookahead of a trajectory, in seconds. */
export const horizonSeconds = (trajectory: Trajectory): number =>
  trajectory.times.length ? trajectory.times[trajectory.times.length - 1] : 0

export const rgb = (c: readonly number[], alpha = 1) =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`

/**
 * Fixed per-hand colours: a hand is the same colour in every mode.
 *
 * Dash encodes gripper open/closed and colour encodes which hand, so modes are
 * told apart by interaction instead — hovering one dims the rest. Cyan/amber
 * reads clearly over a camera image and stays distinct from the red
 * current-position markers and the grey executing plan.
 */
export const HAND_COLOR: readonly number[][] = [
  [56, 208, 255], // left
  [255, 170, 64], // right
]

export const handColor = (arm: number): readonly number[] =>
  HAND_COLOR[arm] ?? HAND_COLOR[0]

export const isClosed = (width: number, closedBelow: number) => width < closedBelow

/**
 * Split a row range into contiguous runs of the same gripper state, so each run
 * can be stroked with its own dash pattern. Runs overlap by one row so the
 * drawn segments join up instead of leaving a gap at each transition.
 */
export function gripRuns(
  grip: readonly number[] | undefined,
  from: number,
  to: number,
  closedBelow: number,
): Array<{ start: number; end: number; closed: boolean }> {
  const out: Array<{ start: number; end: number; closed: boolean }> = []
  if (to <= from) return out
  if (!grip?.length) return [{ start: from, end: to, closed: false }]

  let start = from
  let closed = isClosed(grip[from] ?? 1, closedBelow)
  for (let i = from + 1; i <= to; i++) {
    const c = isClosed(grip[Math.min(i, grip.length - 1)] ?? 1, closedBelow)
    if (c !== closed || i === to) {
      out.push({ start, end: i, closed })
      start = i
      closed = c
    }
  }
  return out
}

/**
 * What to mark on a mode, given what the operator is being asked about.
 *
 * `hand` — one hand's outcome point, drawn per hand and independent of the other.
 * `pair` — the decision is about the two hands together, so instead of two loose
 *          endpoints we draw the segment between them and mark its midpoint, which
 *          reads as a relationship rather than two independent targets. `ends` is in
 *          arm order, so ends[0] is the left hand.
 */
export type Marker =
  | { kind: 'hand'; arm: number; point: number[] }
  | { kind: 'pair'; point: number[]; ends: number[][] }

export function modeMarkers(
  trajectory: Trajectory,
  outcomeIndex: number,
  decision: Decision | null | undefined,
): Marker[] {
  const end = Math.max(0, Math.min(outcomeIndex, trajectory.times.length - 1))
  const at = (arm: number) => trajectory.points[arm]?.[end]
  const hand = (arm: number): Marker[] => {
    const point = at(arm)
    return point ? [{ kind: 'hand', arm, point }] : []
  }
  const bothHands = () => trajectory.points.map((_, i) => i).flatMap(hand)

  if (!decision || !isPairDecision(decision.kind)) return bothHands()

  const ends = trajectory.points.map((_, arm) => at(arm)).filter(Boolean) as number[][]
  if (ends.length < 2) return ends.length ? hand(0) : []
  const mid = ends[0].map((v, i) => (v + ends[1][i]) / 2)
  return [{ kind: 'pair', point: mid, ends }]
}

/**
 * Is this decision about the two hands together?
 */
function isPairDecision(kind: DecisionKind): boolean {
  switch (kind) {
    case 'inter_hand':
    case 'static':
      return true
    // `initial` has no acting hand yet and `none` is just the end of the horizon;
    // neither is a claim about the two hands relating to each other.
    case 'initial':
    case 'gripper':
    case 'none':
      return false
  }
}

/** One replay pass, then a beat before it loops. Shared so both views animate alike. */
export const REPLAY_S = 2.2
export const REPLAY_HOLD_S = 0.45

/**
 * Playhead position, in seconds along the trajectory, for a looping replay that
 * started at `hoverStartMs`. Always plays in the same wall-clock time regardless of
 * how far ahead the mode reaches, so options stay comparable.
 */
export function replayTime(hoverStartMs: number, span: number): number {
  const phase = ((performance.now() - hoverStartMs) / 1000) % (REPLAY_S + REPLAY_HOLD_S)
  return Math.min(1, phase / REPLAY_S) * span
}

/** Seconds from now to a trajectory's own next decision point. */
export const outcomeTime = (trajectory: Trajectory, outcomeIndex: number): number => {
  const { times } = trajectory
  if (!times.length) return 0
  return times[Math.max(0, Math.min(outcomeIndex, times.length - 1))]
}
