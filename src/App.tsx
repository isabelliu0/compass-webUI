import { useEffect, useState } from 'react'

import { apiBase } from './api/client'
import { useOperator } from './api/useOperator'
import { CameraView } from './components/CameraView'
import { ModeMenu } from './components/ModeMenu'
import { Scene3D } from './components/Scene3D'
import { StatusBar } from './components/StatusBar'

type View = '2d' | '3d'

const MAX_CAMERA_W = 960
const SIDEBAR_W = 320

function useCameraWidth() {
  const [w, setW] = useState(() =>
    Math.min(MAX_CAMERA_W, window.innerWidth - SIDEBAR_W - 64),
  )
  useEffect(() => {
    const onResize = () =>
      setW(Math.max(360, Math.min(MAX_CAMERA_W, window.innerWidth - SIDEBAR_W - 64)))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return w
}

export default function App() {
  const { info, state, remaining, connected, error, lastSelect, choose, togglePause } =
    useOperator()
  const cameraWidth = useCameraWidth()
  const [hovered, setHovered] = useState<number | null>(null)
  const [view, setView] = useState<View>('3d')
  const camera = info?.camera ?? null
  const closedBelow = info?.grip_closed_below ?? 0.75
  const cameraHeight = camera
    ? Math.round((cameraWidth * camera.height) / camera.width)
    : 540

  return (
    <div className="app">
      <StatusBar
        info={info}
        state={state}
        remaining={remaining}
        connected={connected}
        error={error}
        lastSelect={lastSelect}
        onTogglePause={togglePause}
      />

      <main>
        <section>
          <p className="caption">
            <span className="viewtabs">
              <button
                type="button"
                className={view === '2d' ? 'on' : ''}
                onClick={() => setView('2d')}
              >
                camera
              </button>
              <button
                type="button"
                className={view === '3d' ? 'on' : ''}
                onClick={() => setView('3d')}
              >
                3D scene
              </button>
            </span>
            <span>
              {view === '2d'
                ? ' — hover an outcome marker to replay that option'
                : ' — the same options in space; orbit to see them from another angle'}
            </span>
          </p>
          {camera && view === '3d' ? (
            <Scene3D
              camera={camera}
              state={state}
              width={cameraWidth}
              height={cameraHeight}
              hovered={hovered}
              closedBelow={closedBelow}
              onHover={setHovered}
            />
          ) : camera ? (
            <CameraView
              camera={camera}
              state={state}
              width={cameraWidth}
              closedBelow={closedBelow}
              hovered={hovered}
              onHover={setHovered}
            />
          ) : (
            <div className="notice">
              {info
                ? 'This server has no camera geometry, so there is nothing to render. Start it with --camera-info and an extrinsic (see the serve-dp-steer service).'
                : `Waiting for ${apiBase} /operator/info…`}
            </div>
          )}
          <p className="legend">
            <span className="sw" style={{ background: 'rgb(56,208,255)' }} /> left hand
            <span className="sw" style={{ background: 'rgb(255,170,64)' }} /> right hand
            <span className="sw" style={{ background: '#ef4444' }} /> where the hands are
            now
            <span className="sw" style={{ background: '#aaa' }} /> plan being executed
            <br />
            Every option is drawn only as far as its <b>own next decision point</b>. A{' '}
            <b>solid</b> line means the gripper is closed, a <b>dashed</b> line means it
            is open. Hovering an option replays it and dims the others.
            <br />
            Each hand&rsquo;s endpoint is ringed separately. When the decision is about{' '}
            <b>how the hands move together</b>, those two rings are replaced by a single
            marker at their midpoint, joined by a line and split so each half carries
            that hand&rsquo;s colour.
          </p>
        </section>

        <aside style={{ width: SIDEBAR_W }}>
          {camera && state ? (
            <ModeMenu
              camera={camera}
              state={state}
              closedBelow={closedBelow}
              hovered={hovered}
              onHover={setHovered}
              onSelect={choose}
            />
          ) : null}
        </aside>
      </main>
    </div>
  )
}
