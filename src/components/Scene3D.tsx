import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type { Camera, OperatorState } from '../api/types'
import { fetchCloud } from '../render/cloud'
import {
  gripRuns, handColor, modeMarkers, outcomeTime, replayTime, sampleAt,
} from '../render/project'

const CLOUD_POLL_MS = 500
const CLOUD_STRIDE = 6
/** Invisible sphere around each marker, so a marker is easy to point at. */
const HIT_RADIUS_M = 0.045

// Everything the API reports is pelvis-frame, where Z is up. Telling three.js that
// directly is simpler — and less error-prone — than remapping every coordinate.
const UP = new THREE.Vector3(0, 0, 1)

const toColor = (c: readonly number[]) =>
  new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255)

/**
 * Place a three.js camera where the robot's head camera is.
 *
 * The extrinsic maps pelvis into the optical frame, which looks down +Z with +Y down;
 * a three.js camera looks down -Z with +Y up. So invert the extrinsic to get the
 * camera's pose in pelvis, then spin it 180 degrees about X to swap conventions.
 */
function placeAtHead(camera: THREE.PerspectiveCamera, cam: Camera) {
  const T = new THREE.Matrix4().set(
    cam.T_pelvis_in_optical[0][0], cam.T_pelvis_in_optical[0][1],
    cam.T_pelvis_in_optical[0][2], cam.T_pelvis_in_optical[0][3],
    cam.T_pelvis_in_optical[1][0], cam.T_pelvis_in_optical[1][1],
    cam.T_pelvis_in_optical[1][2], cam.T_pelvis_in_optical[1][3],
    cam.T_pelvis_in_optical[2][0], cam.T_pelvis_in_optical[2][1],
    cam.T_pelvis_in_optical[2][2], cam.T_pelvis_in_optical[2][3],
    cam.T_pelvis_in_optical[3][0], cam.T_pelvis_in_optical[3][1],
    cam.T_pelvis_in_optical[3][2], cam.T_pelvis_in_optical[3][3],
  )
  const optInPelvis = T.clone().invert()
  const flip = new THREE.Matrix4().makeRotationX(Math.PI)
  camera.matrixAutoUpdate = false
  camera.matrix.copy(optInPelvis.multiply(flip))
  camera.matrix.decompose(camera.position, camera.quaternion, camera.scale)
  camera.matrixAutoUpdate = true
  // Vertical FOV straight from the intrinsics, so the virtual view matches the real one.
  camera.fov = 2 * Math.atan(cam.height / (2 * cam.K[1][1])) * (180 / Math.PI)
  // A PerspectiveCamera puts the optical axis at the image centre, but a real lens
  // rarely does. Without this the whole scene sits ~20 px off from where the 2D
  // overlay draws it. A view offset moves the axis to (cx, cy) and, unlike editing
  // the projection matrix by hand, survives updateProjectionMatrix() on resize.
  camera.setViewOffset(
    cam.width, cam.height,
    cam.width / 2 - cam.K[0][2],
    cam.height / 2 - cam.K[1][2],
    cam.width, cam.height,
  )
  camera.updateProjectionMatrix()
}

interface Props {
  camera: Camera
  state: OperatorState | null
  width: number
  height: number
  hovered: number | null
  closedBelow: number
  onHover: (modeId: number | null) => void
}

export function Scene3D({
  camera, state, width, height, hovered, closedBelow, onHover,
}: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const scene = useRef<THREE.Scene | null>(null)
  const overlay = useRef<THREE.Group | null>(null)
  const anim = useRef<THREE.Group | null>(null)
  const hits = useRef<THREE.Object3D[]>([])
  const points = useRef<THREE.Points | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const [cloudCount, setCloudCount] = useState<number | null>(null)

  const stateRef = useRef(state)
  const hoverRef = useRef(hovered)
  const onHoverRef = useRef(onHover)
  const closedBelowRef = useRef(closedBelow)
  const resetView = useRef<() => void>(() => {})
  stateRef.current = state
  hoverRef.current = hovered
  onHoverRef.current = onHover
  closedBelowRef.current = closedBelow

  // --- one-time scene setup -------------------------------------------------
  useEffect(() => {
    const el = mount.current
    if (!el) return

    const sc = new THREE.Scene()
    sc.background = new THREE.Color(0x0b0c0f)
    const cam = new THREE.PerspectiveCamera(50, width / height, 0.05, 20)
    cam.up.copy(UP)
    placeAtHead(cam, camera)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    const controls = new OrbitControls(cam, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    // OrbitControls re-derives the camera's roll from `up` on every update, which
    // shifts it a few pixels off the true optical orientation. Putting the orbit
    // target exactly along the head's own forward axis makes that recomputation a
    // no-op, so the opening view really is the robot's view.
    const toHeadView = () => {
      placeAtHead(cam, camera)
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
      controls.target.copy(cam.position.clone().add(fwd.multiplyScalar(0.8)))
      controls.update()
    }
    toHeadView()
    resetView.current = toHeadView

    const grp = new THREE.Group()
    sc.add(grp)
    const animGrp = new THREE.Group()
    sc.add(animGrp)

    // Point at a marker to replay that option, the same gesture as the 2D view.
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onMove = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(pointer, cam)
      const hit = raycaster.intersectObjects(hits.current, false)[0]
      const id = hit ? (hit.object.userData.modeId as number) : null
      if (id !== hoverRef.current) onHoverRef.current(id)
    }
    const onLeave = () => onHoverRef.current(null)

    // Pelvis origin marker + ground grid, so "which way is up" is never ambiguous
    // once you have orbited away from the robot's own viewpoint.
    const grid = new THREE.GridHelper(2, 20, 0x2a2e37, 0x1c1f26)
    grid.rotateX(Math.PI / 2)
    sc.add(grid)
    sc.add(new THREE.AxesHelper(0.15))

    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    scene.current = sc
    overlay.current = grp
    anim.current = animGrp
    cameraRef.current = cam
    controlsRef.current = controls

    let raf = 0
    let hoverStart: number | null = null
    let lastHover: number | null = null

    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()

      const s = stateRef.current
      const hov = hoverRef.current
      if (hov !== lastHover) {
        lastHover = hov
        hoverStart = hov == null ? null : performance.now()
      }

      // Replay trail: rebuilt per frame, but it's a handful of points.
      animGrp.clear()
      const mode = s && hov != null ? s.modes.find((m) => m.id === hov) : undefined
      if (mode && hoverStart != null) {
        const end = Math.max(
          0, Math.min(mode.outcome_index, mode.trajectory.times.length - 1))
        const t = replayTime(hoverStart, outcomeTime(mode.trajectory, end))
        mode.trajectory.points.forEach((arm, ai) => {
          if (!arm.length) return
          const colour = toColor(handColor(ai))
          const head = sampleAt(mode.trajectory, ai, t)
          const upto = arm.filter((_, i) => i <= end && mode.trajectory.times[i] <= t)
          if (head) upto.push(head)
          if (upto.length >= 2) {
            const g = new THREE.BufferGeometry().setFromPoints(
              upto.map((p) => new THREE.Vector3(p[0], p[1], p[2])))
            animGrp.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: colour })))
          }
          if (head) {
            const m = new THREE.Mesh(
              new THREE.SphereGeometry(0.011, 14, 10),
              new THREE.MeshBasicMaterial({ color: colour }))
            m.position.set(head[0], head[1], head[2])
            animGrp.add(m)
          }
        })
      }

      renderer.render(sc, cam)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
      scene.current = null
      overlay.current = null
      anim.current = null
      points.current = null
      hits.current = []
    }
    // Rebuilding on resize is handled separately; this runs once per camera geometry.
  }, [camera]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cam = cameraRef.current
    if (!cam) return
    cam.aspect = width / height
    cam.updateProjectionMatrix()
    const canvas = mount.current?.querySelector('canvas')
    if (canvas) {
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
  }, [width, height])

  // --- live point cloud -----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const ac = new AbortController()

    const pull = async () => {
      try {
        const cloud = await fetchCloud(CLOUD_STRIDE, 2.5, ac.signal)
        if (cancelled || !scene.current) return
        if (!cloud) {
          setCloudCount(null)
        } else {
          const geom = new THREE.BufferGeometry()
          geom.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
          geom.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3))
          if (points.current) {
            points.current.geometry.dispose()
            points.current.geometry = geom
          } else {
            const mat = new THREE.PointsMaterial({ size: 0.006, vertexColors: true })
            const pts = new THREE.Points(geom, mat)
            points.current = pts
            scene.current.add(pts)
          }
          setCloudCount(cloud.count)
        }
      } catch {
        /* aborted or offline; the next tick retries */
      } finally {
        if (!cancelled) timer = window.setTimeout(pull, CLOUD_POLL_MS)
      }
    }

    pull()
    return () => {
      cancelled = true
      ac.abort()
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  // --- trajectories + markers ----------------------------------------------
  useEffect(() => {
    const grp = overlay.current
    if (!grp || !state) return

    grp.clear()
    hits.current = []
    const closedBelow = closedBelowRef.current
    /** Invisible, generously sized target so a marker is easy to point at. */
    const hitTarget = (p: number[], modeId: number) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(HIT_RADIUS_M, 8, 6),
        new THREE.MeshBasicMaterial({ visible: false }),
      )
      m.position.set(p[0], p[1], p[2])
      m.userData.modeId = modeId
      grp.add(m)
      hits.current.push(m)
    }
    const vec = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2])

    /** Solid when the gripper is closed, dashed when open — same rule as the 2D view. */
    const line = (
      pts: number[][], colour: THREE.Color, opacity: number, dashed = false,
    ) => {
      if (pts.length < 2) return
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(vec))
      const mat = dashed
        ? new THREE.LineDashedMaterial({
            color: colour, transparent: true, opacity, dashSize: 0.012, gapSize: 0.012 })
        : new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity })
      const l = new THREE.Line(g, mat)
      if (dashed) l.computeLineDistances()
      grp.add(l)
    }

    /**
     * The 2D view marks a hand with a translucent disc, a ring and a solid centre.
     * The 3D analogue is a translucent halo around a solid core, which reads the same
     * way from any angle.
     */
    const handMarker = (p: number[], colour: THREE.Color, big: boolean) => {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(big ? 0.019 : 0.014, 18, 14),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.28 }))
      halo.position.copy(vec(p))
      grp.add(halo)
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(big ? 0.007 : 0.005, 14, 10),
        new THREE.MeshBasicMaterial({ color: colour }))
      core.position.copy(vec(p))
      grp.add(core)
    }

    /**
     * Pair marker, split so each half carries its own hand's colour — the 3D form of
     * the split disc. The 2D view splits screen-left/right; here the split plane is
     * perpendicular to the line joining the hands, so each half genuinely faces its
     * own hand from any viewpoint.
     */
    const pairMarker = (p: number[], ends: number[][], big: boolean) => {
      const r = big ? 0.019 : 0.014
      const axis = vec(ends[1]).sub(vec(ends[0])).normalize()
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis)
      for (const [phiStart, arm] of [[0, 1], [Math.PI, 0]] as const) {
        const half = new THREE.Mesh(
          new THREE.SphereGeometry(r, 18, 14, phiStart, Math.PI),
          new THREE.MeshBasicMaterial({
            color: toColor(handColor(arm)), transparent: true, opacity: 0.5,
            side: THREE.DoubleSide }))
        half.position.copy(vec(p))
        half.quaternion.copy(q)
        grp.add(half)
      }
    }

    /** Connector fading from one hand's colour to the other, like the 2D gradient. */
    const connector = (ends: number[][], opacity: number) => {
      const g = new THREE.BufferGeometry().setFromPoints(ends.map(vec))
      const a = toColor(handColor(0))
      const b = toColor(handColor(1))
      g.setAttribute('color', new THREE.Float32BufferAttribute(
        [a.r, a.g, a.b, b.r, b.g, b.b], 3))
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({
        vertexColors: true, transparent: true, opacity, dashSize: 0.01, gapSize: 0.01 }))
      l.computeLineDistances()
      grp.add(l)
    }

    // What's executing right now, behind the options — same grey, same grip styling
    // as the 2D overlay.
    const plan = new THREE.Color(0x969696)
    state.current_plan.points.forEach((arm, ai) => {
      if (!arm.length) return
      for (const run of gripRuns(state.current_plan.grip?.[ai], 0, arm.length - 1,
                                 closedBelow)) {
        line(arm.slice(run.start, run.end + 1), plan, 0.75, !run.closed)
      }
    })

    for (const mode of state.modes) {
      const dim = hovered != null && hovered !== mode.id
      const on = mode.id === state.selected_mode_id || mode.id === hovered
      // Marker emphasis follows *hover* alone, matching the 2D view: the selected mode
      // is already called out by the menu card, so enlarging it here would double up.
      const pointedAt = mode.id === hovered
      const end = Math.max(0, Math.min(mode.outcome_index, mode.trajectory.times.length - 1))
      const alpha = dim ? 0.18 : on ? 1 : 0.6
      mode.trajectory.points.forEach((arm, ai) => {
        if (!arm.length) return
        const colour = toColor(handColor(ai))
        for (const run of gripRuns(mode.trajectory.grip?.[ai], 0, end, closedBelow)) {
          line(arm.slice(run.start, run.end + 1), colour, alpha, !run.closed)
        }
      })
      for (const marker of modeMarkers(mode.trajectory, mode.outcome_index, mode.outcome)) {
        // Dimmed modes keep their hit target, so pointing at one brings it back.
        hitTarget(marker.point, mode.id)
        if (dim) continue
        if (marker.kind === 'pair') {
          connector(marker.ends, on ? 1 : 0.6)
          pairMarker(marker.point, marker.ends, pointedAt)
        } else {
          handMarker(marker.point, toColor(handColor(marker.arm)), pointedAt)
        }
      }
    }
    for (const ee of state.current_ee) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xef4444 }))
      m.position.copy(vec(ee))
      grp.add(m)
    }
  }, [state, hovered])

  return (
    <div className="scene3d" style={{ width, height }}>
      <div ref={mount} />
      <span className="scene-badge">
        {cloudCount == null
          ? 'no depth — run the robot client with --send-depth'
          : `${cloudCount.toLocaleString()} points · drag to orbit, scroll to zoom`}
      </span>
      <button type="button" className="scene-reset" onClick={() => resetView.current()}>
        head view
      </button>
    </div>
  )
}
