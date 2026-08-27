import type { Camera, Trajectory } from '../api/types'

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
