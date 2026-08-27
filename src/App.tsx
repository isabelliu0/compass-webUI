import { useEffect, useState } from 'react'

import { apiBase } from './api/client'
import { useOperator } from './api/useOperator'
import { CameraView } from './components/CameraView'
import { ModeMenu } from './components/ModeMenu'
import { StatusBar } from './components/StatusBar'

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
  const camera = info?.camera ?? null

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
            robot camera<span> — every offered mode drawn together on the live frame</span>
          </p>
          {camera ? (
            <CameraView camera={camera} state={state} width={cameraWidth} />
          ) : (
            <div className="notice">
              {info
                ? 'This server has no camera geometry, so there is nothing to render. Start it with --camera-info and an extrinsic (see the serve-dp-steer service).'
                : `Waiting for ${apiBase} /operator/info…`}
            </div>
          )}
          <p className="legend">
            <span className="sw" style={{ background: '#ef4444' }} /> current finger-centre
            <span className="sw" style={{ background: '#aaa' }} /> plan being executed
            <span
              className="sw"
              style={{ background: 'linear-gradient(90deg,#1f77b4,#ff7f0e,#2ca02c)' }}
            />{' '}
            offered modes — the ring marks each mode&rsquo;s own next decision point.
            Solid is the left arm, dashed the right.
          </p>
        </section>

        <aside style={{ width: SIDEBAR_W }}>
          {camera && state ? (
            <ModeMenu camera={camera} state={state} onSelect={choose} />
          ) : null}
        </aside>
      </main>
    </div>
  )
}
