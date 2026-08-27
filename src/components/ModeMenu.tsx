import { useEffect, useRef } from 'react'

import { frameUrl } from '../api/client'
import type { Camera, ModeOption, OperatorState } from '../api/types'
import {
  gripRuns,
  handColor,
  horizonSeconds,
  makeProjector,
  modeMarkers,
  outcomeTime,
  rgb,
  type Point2,
} from '../render/project'

const THUMB_W = 240
const LEFT_ARC = [Math.PI / 2, (3 * Math.PI) / 2] as const
const RIGHT_ARC = [-Math.PI / 2, Math.PI / 2] as const

/**
 * Each mode alone on the frame as it was at this decision point, trimmed to that
 * mode's own next decision point. The background is captured once per epoch so
 * the menu is a still comparison rather than views shifting while the operator
 * is choosing.
 */
function Thumbnail({
  camera,
  mode,
  background,
  closedBelow,
  active,
}: {
  camera: Camera
  mode: ModeOption
  background: HTMLImageElement | null
  closedBelow: number
  active: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const height = Math.round((THUMB_W * camera.height) / camera.width)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = THUMB_W * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (background?.complete && background.naturalWidth) {
      ctx.drawImage(background, 0, 0, THUMB_W, height)
      ctx.fillStyle = `rgba(0,0,0,${active ? 0.1 : 0.3})`
      ctx.fillRect(0, 0, THUMB_W, height)
    } else {
      ctx.fillStyle = '#0b0b0d'
      ctx.fillRect(0, 0, THUMB_W, height)
    }

    const project = makeProjector(camera, THUMB_W)
    const end = Math.max(0, Math.min(mode.outcome_index, mode.trajectory.times.length - 1))

    mode.trajectory.points.forEach((arm, ai) => {
      if (!arm.length) return
      gripRuns(mode.trajectory.grip?.[ai], 0, end, closedBelow).forEach((run) => {
        const q = arm
          .slice(run.start, run.end + 1)
          .map(project)
          .filter((p): p is Point2 => p !== null)
        if (q.length < 2) return
        ctx.setLineDash(run.closed ? [] : [3, 3])
        ctx.strokeStyle = rgb(handColor(ai), 0.98)
        ctx.lineWidth = active ? 2.4 : 1.8
        ctx.lineCap = 'round'
        ctx.beginPath()
        q.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
        ctx.setLineDash([])
      })
    })

    const r = active ? 5.5 : 4.5
    for (const marker of modeMarkers(
      mode.trajectory, mode.outcome_index, mode.outcome,
    )) {
      const p = project(marker.point)

      if (marker.kind === 'hand') {
        if (!p) continue
        ctx.strokeStyle = rgb(handColor(marker.arm), 1)
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2)
        ctx.stroke()
        continue
      }

      // Pair: gradient segment between the hands, and a midpoint ring split so each
      // half carries its own hand's colour. Same encoding as the main camera view.
      const q = marker.ends.map(project).filter((pt): pt is Point2 => pt !== null)
      if (q.length === 2) {
        const grad = ctx.createLinearGradient(q[0][0], q[0][1], q[1][0], q[1][1])
        grad.addColorStop(0, rgb(handColor(0), 0.9))
        grad.addColorStop(1, rgb(handColor(1), 0.9))
        ctx.setLineDash([2, 3])
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.moveTo(q[0][0], q[0][1])
        ctx.lineTo(q[1][0], q[1][1])
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (!p) continue
      ctx.lineWidth = 1.8
      for (const [arc, arm] of [[LEFT_ARC, 0], [RIGHT_ARC, 1]] as const) {
        ctx.strokeStyle = rgb(handColor(arm), 1)
        ctx.beginPath()
        ctx.arc(p[0], p[1], r, arc[0], arc[1])
        ctx.stroke()
      }
    }
  }, [camera, mode, background, closedBelow, active, height])

  return <canvas ref={ref} className="thumb" style={{ width: THUMB_W, height }} />
}

interface Props {
  camera: Camera
  state: OperatorState
  closedBelow: number
  hovered: number | null
  onHover: (modeId: number | null) => void
  onSelect: (modeId: number) => void
}

export function ModeMenu({
  camera,
  state,
  closedBelow,
  hovered,
  onHover,
  onSelect,
}: Props) {
  const bg = useRef<HTMLImageElement | null>(null)
  const epoch = useRef<number>(-1)

  // Freeze one background per epoch, shared by every card.
  if (epoch.current !== state.menu_epoch) {
    epoch.current = state.menu_epoch
    const img = new Image()
    img.src = frameUrl()
    bg.current = img
  }

  if (!state.menu_ready) {
    return (
      <div className="menu">
        <p className="menu-title">sampling modes at this decision point…</p>
      </div>
    )
  }

  if (!state.modes.length) {
    return (
      <div className="menu">
        <p className="menu-title">no modes on offer</p>
      </div>
    )
  }

  const total = state.modes.reduce((a, m) => a + m.count, 0) || 1

  return (
    <div className="menu">
      <p className="menu-title">
        menu @ epoch {state.menu_epoch}
        <span> — {state.modes.length} option(s), each drawn only as far as its own
          next decision point</span>
      </p>
      {state.modes.map((mode) => {
        const selected = mode.id === state.selected_mode_id
        const active = mode.id === hovered
        const end = Math.max(0, Math.min(mode.outcome_index, mode.trajectory.times.length - 1))
        return (
          <button
            key={mode.id}
            type="button"
            className={`mode-card${selected ? ' selected' : ''}${active ? ' hovered' : ''}`}
            onMouseEnter={() => onHover(mode.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(mode.id)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(mode.id)}
          >
            <div className="mode-head">
              mode {mode.id}
              {mode.id === 0 && <span className="badge">MAIN</span>}
              <span className="mode-meta">
                {mode.count} samples · {outcomeTime(mode.trajectory, end).toFixed(1)}s
                {' of '}
                {horizonSeconds(mode.trajectory).toFixed(1)}s
              </span>
            </div>
            <div className="dominance">
              <i style={{ width: `${((100 * mode.count) / total).toFixed(0)}%` }} />
            </div>
            <Thumbnail
              camera={camera}
              mode={mode}
              background={bg.current}
              closedBelow={closedBelow}
              active={active}
            />
          </button>
        )
      })}
    </div>
  )
}
