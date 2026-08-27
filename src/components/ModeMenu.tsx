import { useEffect, useRef } from 'react'

import { frameUrl } from '../api/client'
import type { Camera, ModeOption, OperatorState } from '../api/types'
import { horizonSeconds, makeProjector, rgb, type Point2 } from '../render/project'

const THUMB_W = 240

/**
 * Each mode alone on the frame as it was at this decision point. The background
 * is captured once per epoch so the menu is a still comparison rather than a set
 * of live views that keep changing underneath the operator.
 */
function Thumbnail({
  camera,
  mode,
  background,
  selected,
}: {
  camera: Camera
  mode: ModeOption
  background: HTMLImageElement | null
  selected: boolean
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
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
      ctx.fillRect(0, 0, THUMB_W, height)
    } else {
      ctx.fillStyle = '#0b0b0d'
      ctx.fillRect(0, 0, THUMB_W, height)
    }

    const project = makeProjector(camera, THUMB_W)
    mode.trajectory.points.forEach((arm, i) => {
      if (!arm.length) return
      const pts = arm
        .map(project)
        .filter((p): p is Point2 => p !== null)
      if (pts.length >= 2) {
        ctx.setLineDash(i === 0 ? [] : [3, 3])
        ctx.strokeStyle = rgb(mode.color, 0.98)
        ctx.lineWidth = selected ? 2.4 : 1.8
        ctx.beginPath()
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
        ctx.setLineDash([])
      }
      const outcome = project(arm[Math.min(mode.outcome_index, arm.length - 1)])
      if (outcome) {
        ctx.strokeStyle = rgb(mode.color)
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(outcome[0], outcome[1], selected ? 5 : 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    })
  }, [camera, mode, background, selected, height])

  return <canvas ref={ref} className="thumb" style={{ width: THUMB_W, height }} />
}

interface Props {
  camera: Camera
  state: OperatorState
  onSelect: (modeId: number) => void
}

export function ModeMenu({ camera, state, onSelect }: Props) {
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
        <span> — {state.modes.length} mode(s), each shown alone on the frozen frame</span>
      </p>
      {state.modes.map((mode) => {
        const selected = mode.id === state.selected_mode_id
        return (
          <button
            key={mode.id}
            type="button"
            className={`mode-card${selected ? ' selected' : ''}`}
            style={{ borderLeftColor: rgb(mode.color) }}
            onClick={() => onSelect(mode.id)}
          >
            <div className="mode-head">
              <span className="swatch" style={{ background: rgb(mode.color) }} />
              mode {mode.id}
              {mode.id === 0 && <span className="badge">MAIN</span>}
              <span className="mode-meta">
                {mode.count} samples · {horizonSeconds(mode.trajectory).toFixed(1)}s
              </span>
            </div>
            <div className="dominance">
              <i
                style={{
                  width: `${((100 * mode.count) / total).toFixed(0)}%`,
                  background: rgb(mode.color),
                }}
              />
            </div>
            <Thumbnail
              camera={camera}
              mode={mode}
              background={bg.current}
              selected={selected}
            />
          </button>
        )
      })}
    </div>
  )
}
