import { useCallback, useEffect, useRef, useState } from 'react'

import { frameUrl } from '../api/client'
import type { Camera, ModeOption, OperatorState, Trajectory } from '../api/types'
import {
  gripRuns,
  handColor,
  makeProjector,
  modeMarkers,
  outcomeTime,
  replayTime,
  rgb,
  sampleAt,
  type Point2,
} from '../render/project'

const FRAME_POLL_MS = 400
const HIT_RADIUS_PX = 18

/** Preload each frame off-screen and swap on load, so the view never flickers. */
function useLiveFrame(enabled: boolean) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: number | undefined

    const pull = () => {
      const img = new Image()
      const next = () => {
        if (!cancelled) timer = window.setTimeout(pull, FRAME_POLL_MS)
      }
      img.onload = () => {
        if (!cancelled) setSrc(img.src)
        next()
      }
      img.onerror = next
      img.src = frameUrl()
    }

    pull()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [enabled])

  return src
}

type Projector = (p: readonly number[]) => Point2 | null

function stroke(
  ctx: CanvasRenderingContext2D,
  pts: number[][],
  project: Projector,
  style: string,
  width: number,
  dash: number[],
) {
  const q = pts.map(project).filter((p): p is Point2 => p !== null)
  if (q.length < 2) return
  ctx.setLineDash(dash)
  ctx.strokeStyle = style
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.stroke()
  ctx.setLineDash([])
}

function disc(
  ctx: CanvasRenderingContext2D,
  p: number[] | undefined,
  project: Projector,
  style: string,
  r: number,
) {
  if (!p) return
  const q = project(p)
  if (!q) return
  ctx.fillStyle = style
  ctx.beginPath()
  ctx.arc(q[0], q[1], r, 0, Math.PI * 2)
  ctx.fill()
}

/** The marker on a mode's outcome point — what the operator aims at to preview it. */
function highlight(
  ctx: CanvasRenderingContext2D,
  p: number[] | undefined,
  project: Projector,
  colour: readonly number[],
  active: boolean,
) {
  if (!p) return
  const q = project(p)
  if (!q) return
  const r = active ? 11 : 8
  ctx.beginPath()
  ctx.arc(q[0], q[1], r, 0, Math.PI * 2)
  ctx.fillStyle = rgb(colour, active ? 0.3 : 0.16)
  ctx.fill()
  ctx.lineWidth = active ? 2.6 : 1.8
  ctx.strokeStyle = rgb(colour, active ? 1 : 0.75)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(q[0], q[1], 2.4, 0, Math.PI * 2)
  ctx.fillStyle = rgb(colour, 1)
  ctx.fill()
}

/** Rows of a trajectory up to and including its own next decision point. */
const previewEnd = (t: Trajectory, outcomeIndex: number) =>
  Math.max(0, Math.min(outcomeIndex, t.times.length - 1))

const markersFor = (mode: ModeOption) =>
  modeMarkers(mode.trajectory, mode.outcome_index, mode.outcome)

const LEFT_ARC: [number, number] = [Math.PI / 2, (3 * Math.PI) / 2]
const RIGHT_ARC: [number, number] = [-Math.PI / 2, Math.PI / 2]

/**
 * The segment joining the two hands, fading from one hand's colour to the other so
 * it reads as belonging to both rather than to neither. `ends` is in arm order.
 */
function connector(
  ctx: CanvasRenderingContext2D,
  ends: number[][],
  project: Projector,
  alpha: number,
) {
  const q = ends.map(project).filter((p): p is Point2 => p !== null)
  if (q.length < 2) return
  const grad = ctx.createLinearGradient(q[0][0], q[0][1], q[1][0], q[1][1])
  grad.addColorStop(0, rgb(handColor(0), alpha * 0.9))
  grad.addColorStop(1, rgb(handColor(1), alpha * 0.9))
  ctx.setLineDash([3, 4])
  ctx.strokeStyle = grad
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(q[0][0], q[0][1])
  ctx.lineTo(q[1][0], q[1][1])
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * Marker at the midpoint between the hands, split down the middle: the left half
 * carries the left hand's colour and the right half the right hand's, so the point
 * visibly belongs to both.
 */
function pairMarker(
  ctx: CanvasRenderingContext2D,
  point: number[],
  project: Projector,
  active: boolean,
) {
  const q = project(point)
  if (!q) return
  const [x, y] = q
  const r = active ? 11 : 8
  const halves: Array<[[number, number], readonly number[]]> = [
    [LEFT_ARC, handColor(0)],
    [RIGHT_ARC, handColor(1)],
  ]

  for (const [[from, to], colour] of halves) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y, r, from, to)
    ctx.closePath()
    ctx.fillStyle = rgb(colour, active ? 0.4 : 0.24)
    ctx.fill()

    ctx.beginPath()
    ctx.arc(x, y, r, from, to)
    ctx.strokeStyle = rgb(colour, active ? 1 : 0.8)
    ctx.lineWidth = active ? 2.6 : 1.8
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y, 2.8, from, to)
    ctx.closePath()
    ctx.fillStyle = rgb(colour, 1)
    ctx.fill()
  }
}

interface Props {
  camera: Camera
  state: OperatorState | null
  width: number
  closedBelow: number
  hovered: number | null
  onHover: (modeId: number | null) => void
}

export function CameraView({
  camera,
  state,
  width,
  closedBelow,
  hovered,
  onHover,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const src = useLiveFrame(true)
  const height = Math.round((width * camera.height) / camera.width)

  // The animation runs on its own clock, so the draw loop reads the latest props
  // from refs rather than restarting whenever a poll lands.
  const stateRef = useRef(state)
  const hoverRef = useRef(hovered)
  stateRef.current = state
  hoverRef.current = hovered

  const hitTest = useCallback(
    (mx: number, my: number): number | null => {
      const s = stateRef.current
      if (!s) return null
      const project = makeProjector(camera, width)
      for (const mode of s.modes) {
        for (const marker of markersFor(mode)) {
          const q = project(marker.point)
          if (!q) continue
          if (Math.hypot(q[0] - mx, q[1] - my) <= HIT_RADIUS_PX) return mode.id
        }
      }
      return null
    },
    [camera, width, closedBelow],
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      onHover(hitTest(e.clientX - r.left, e.clientY - r.top))
    },
    [hitTest, onHover],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let hoverStart: number | null = null
    let lastHover: number | null = null

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const s = stateRef.current
      const hov = hoverRef.current

      if (hov !== lastHover) {
        lastHover = hov
        hoverStart = hov == null ? null : performance.now()
      }

      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      if (!s) return

      const project = makeProjector(camera, width)

      // What's executing right now, behind everything else.
      s.current_plan.points.forEach((arm, ai) => {
        gripRuns(s.current_plan.grip?.[ai], 0, arm.length - 1, closedBelow).forEach(
          (run) =>
            stroke(
              ctx,
              arm.slice(run.start, run.end + 1),
              project,
              'rgba(150,150,150,0.75)',
              1.8,
              run.closed ? [] : [4, 4],
            ),
        )
      })

      // Offered modes, each trimmed to its own next decision point.
      for (const mode of s.modes) {
        const dim = hov != null && hov !== mode.id
        const on = mode.id === s.selected_mode_id || mode.id === hov
        const end = previewEnd(mode.trajectory, mode.outcome_index)

        mode.trajectory.points.forEach((arm, ai) => {
          if (!arm.length) return
          const colour = handColor(ai)
          const alpha = dim ? 0.18 : on ? 1 : 0.6
          gripRuns(mode.trajectory.grip?.[ai], 0, end, closedBelow).forEach((run) =>
            stroke(
              ctx,
              arm.slice(run.start, run.end + 1),
              project,
              rgb(colour, alpha),
              on ? 3.2 : 2.1,
              run.closed ? [] : [5, 5],
            ),
          )
        })

        if (!dim) {
          for (const marker of markersFor(mode)) {
            if (marker.kind === 'pair') {
              connector(ctx, marker.ends, project, on ? 1 : 0.6)
              pairMarker(ctx, marker.point, project, mode.id === hov)
            } else {
              highlight(ctx, marker.point, project, handColor(marker.arm),
                        mode.id === hov)
            }
          }
        }
      }

      // Hovered mode: replay both hands from now to the decision point.
      const hovMode = hov == null ? null : s.modes.find((m) => m.id === hov)
      if (hovMode && hoverStart != null) {
        const end = previewEnd(hovMode.trajectory, hovMode.outcome_index)
        const t = replayTime(hoverStart, outcomeTime(hovMode.trajectory, end))

        hovMode.trajectory.points.forEach((arm, ai) => {
          if (!arm.length) return
          const colour = handColor(ai)
          const head = sampleAt(hovMode.trajectory, ai, t)
          const upto = arm.filter((_, i) => i <= end && hovMode.trajectory.times[i] <= t)
          if (head) upto.push(head)
          stroke(ctx, upto, project, rgb(colour, 1), 4.4, [])
          disc(ctx, head ?? undefined, project, rgb(colour, 1), 5.5)
        })
      }

      for (const ee of s.current_ee) disc(ctx, ee, project, '#ef4444', 5.5)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [camera, width, height, closedBelow])

  return (
    <div className="camera" style={{ width, height }}>
      {src ? (
        <img src={src} width={width} height={height} alt="robot head camera" />
      ) : (
        <div className="camera-empty">waiting for the first frame…</div>
      )}
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => onHover(null)}
      />
    </div>
  )
}
