import { useEffect, useRef, useState } from 'react'

import { frameUrl } from '../api/client'
import type { Camera, OperatorState, Trajectory } from '../api/types'
import { makeProjector, rgb, type Point2 } from '../render/project'

const FRAME_POLL_MS = 400

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

function polyline(
  ctx: CanvasRenderingContext2D,
  pts: number[][],
  project: (p: readonly number[]) => Point2 | null,
  style: string,
  width: number,
  dash: number[] = [],
) {
  const projected = pts.map(project).filter((p): p is Point2 => p !== null)
  if (projected.length < 2) return
  ctx.setLineDash(dash)
  ctx.strokeStyle = style
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.beginPath()
  projected.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.stroke()
  ctx.setLineDash([])
}

function marker(
  ctx: CanvasRenderingContext2D,
  p: number[] | undefined,
  project: (p: readonly number[]) => Point2 | null,
  style: string,
  radius: number,
  fill: boolean,
) {
  if (!p) return
  const q = project(p)
  if (!q) return
  ctx.beginPath()
  ctx.arc(q[0], q[1], radius, 0, Math.PI * 2)
  if (fill) {
    ctx.fillStyle = style
    ctx.fill()
  } else {
    ctx.strokeStyle = style
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

/** Left arm solid, right arm dashed — matches the legend. */
const dashFor = (arm: number) => (arm === 0 ? [] : [5, 4])

function drawPlan(
  ctx: CanvasRenderingContext2D,
  plan: Trajectory,
  project: (p: readonly number[]) => Point2 | null,
) {
  plan.points.forEach((arm, i) =>
    polyline(ctx, arm, project, 'rgba(170, 170, 170, 0.9)', 2, dashFor(i)),
  )
}

function drawModes(
  ctx: CanvasRenderingContext2D,
  state: OperatorState,
  project: (p: readonly number[]) => Point2 | null,
) {
  for (const mode of state.modes) {
    const on = mode.id === state.selected_mode_id
    const colour = rgb(mode.color, on ? 1 : 0.55)
    mode.trajectory.points.forEach((arm, i) => {
      if (!arm.length) return
      polyline(ctx, arm, project, colour, on ? 3.2 : 2, dashFor(i))
      // ring = where this mode's own next decision point lands
      const outcome = arm[Math.min(mode.outcome_index, arm.length - 1)]
      marker(ctx, outcome, project, rgb(mode.color, on ? 1 : 0.6), on ? 7 : 5, false)
      marker(ctx, arm[arm.length - 1], project, rgb(mode.color, on ? 1 : 0.6), on ? 4 : 3, true)
    })
  }
}

interface Props {
  camera: Camera
  state: OperatorState | null
  width: number
}

export function CameraView({ camera, state, width }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const src = useLiveFrame(true)
  const height = Math.round((width * camera.height) / camera.width)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!state) return

    const project = makeProjector(camera, width)
    drawPlan(ctx, state.current_plan, project)
    drawModes(ctx, state, project)
    for (const ee of state.current_ee) marker(ctx, ee, project, '#ef4444', 6, true)
  }, [camera, state, width, height])

  return (
    <div className="camera" style={{ width, height }}>
      {src ? (
        <img src={src} width={width} height={height} alt="robot head camera" />
      ) : (
        <div className="camera-empty">waiting for the first frame…</div>
      )}
      <canvas ref={canvasRef} style={{ width, height }} />
    </div>
  )
}
