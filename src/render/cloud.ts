import { apiBase } from '../api/client'

/** Positions in pelvis-frame metres, colours as 0-1 floats ready for a BufferAttribute. */
export interface PointCloud {
  positions: Float32Array
  colors: Float32Array
  count: number
}

/**
 * Fetch the live scene cloud.
 *
 * The server packs it as N*3 float32 xyz followed by N*3 uint8 rgb — 15 bytes per
 * point — so N is implied by the length. JSON would be roughly ten bytes per number
 * for data that goes straight into a GPU buffer.
 */
export async function fetchCloud(
  stride = 6,
  maxDepthM = 2.5,
  signal?: AbortSignal,
): Promise<PointCloud | null> {
  const url = `${apiBase === '(same origin)' ? '' : apiBase}` +
    `/operator/cloud?stride=${stride}&max_depth_m=${maxDepthM}&ts=${Date.now()}`
  const res = await fetch(url, { signal })
  if (!res.ok) return null // 404 until the robot client streams with --send-depth

  const buf = await res.arrayBuffer()
  const count = Math.floor(buf.byteLength / 15)
  if (!count) return null

  const positions = new Float32Array(buf, 0, count * 3)
  const rgb = new Uint8Array(buf, count * 12, count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < colors.length; i++) colors[i] = rgb[i] / 255

  return { positions, colors, count }
}
