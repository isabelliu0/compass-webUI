/**
 * Does the three.js camera reproduce the robot's head view?
 *
 * The 3D scene should open from the robot's own viewpoint, which means its camera has
 * to agree with the K + extrinsic the 2D overlay projects with. This projects the same
 * pelvis-frame points both ways and compares them in pixels.
 *
 *   node scripts/check-camera.mjs                     # fetches /operator/info
 *   node scripts/check-camera.mjs http://host:9000    # explicit server
 */
import * as THREE from 'three'

const base = process.argv[2] ?? 'http://127.0.0.1:5173'
const info = await (await fetch(`${base}/operator/info`)).json()
const cam = info.camera
if (!cam) {
  console.error('server has no camera geometry (start it with --camera-info)')
  process.exit(1)
}

const W = cam.width
const H = cam.height

// Same construction as Scene3D.placeAtHead().
const T = new THREE.Matrix4().set(...cam.T_pelvis_in_optical.flat())
const optInPelvis = T.clone().invert()
const flip = new THREE.Matrix4().makeRotationX(Math.PI)

const c = new THREE.PerspectiveCamera(50, W / H, 0.05, 20)
c.up.set(0, 0, 1)
c.matrixAutoUpdate = false
c.matrix.copy(optInPelvis.clone().multiply(flip))
c.matrix.decompose(c.position, c.quaternion, c.scale)
c.matrixAutoUpdate = true
c.fov = 2 * Math.atan(H / (2 * cam.K[1][1])) * (180 / Math.PI)
c.setViewOffset(W, H, W / 2 - cam.K[0][2], H / 2 - cam.K[1][2], W, H)
c.updateProjectionMatrix()
c.updateMatrixWorld(true)

/** Ground truth: the K + extrinsic projection the 2D overlay uses. */
function viaIntrinsics(p) {
  const M = cam.T_pelvis_in_optical
  const x = M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2] + M[0][3]
  const y = M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2] + M[1][3]
  const z = M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2] + M[2][3]
  return [cam.K[0][0] * (x / z) + cam.K[0][2], cam.K[1][1] * (y / z) + cam.K[1][2]]
}

/** three.js: world -> NDC -> pixels. */
function viaThree(p) {
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(c)
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]
}

console.log('camera position (pelvis, m):', c.position.toArray().map((v) => +v.toFixed(4)))
console.log('vertical FOV:', c.fov.toFixed(2), 'deg')
console.log(`principal point: cx=${cam.K[0][2].toFixed(1)} (centre ${W / 2}), ` +
            `cy=${cam.K[1][2].toFixed(1)} (centre ${H / 2})`)

let worst = 0
for (const p of [
  [0.5, 0, -0.1], [0.6, 0.2, -0.2], [0.7, -0.25, 0.05], [0.45, 0.1, 0.1], [0.9, 0, -0.3],
]) {
  const a = viaIntrinsics(p)
  const b = viaThree(p)
  const err = Math.hypot(a[0] - b[0], a[1] - b[1])
  worst = Math.max(worst, err)
  console.log(
    `  ${JSON.stringify(p).padEnd(18)} K/extr=(${a[0].toFixed(1)}, ${a[1].toFixed(1)})` +
    `  three=(${b[0].toFixed(1)}, ${b[1].toFixed(1)})` +
    `  dx=${(a[0] - b[0]).toFixed(2)} dy=${(a[1] - b[1]).toFixed(2)}`,
  )
}
console.log(worst < 1 ? `OK: views agree (worst ${worst.toFixed(3)} px)` : 'MISMATCH')

// OrbitControls calls lookAt(target) on every update, which recomputes the camera's
// roll from `up`. Placement being right is not enough if that step changes it, so
// check the orientation that actually ends up on screen.
const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion)
console.log('\nforward (pelvis):', fwd.toArray().map((v) => +v.toFixed(3)),
            '  <- +X is robot-forward, +Z is up')
const target = c.position.clone().add(fwd.clone().multiplyScalar(0.8))
c.lookAt(target)
c.updateMatrixWorld(true)
let worst2 = 0
for (const p of [[0.5, 0, -0.1], [0.7, -0.25, 0.05], [0.9, 0, -0.3]]) {
  worst2 = Math.max(worst2, Math.hypot(
    viaIntrinsics(p)[0] - viaThree(p)[0], viaIntrinsics(p)[1] - viaThree(p)[1]))
}
// lookAt re-derives roll from `up`, and we deliberately use pelvis +Z rather than the
// head camera's own up so that orbiting feels level with the world. The head is very
// slightly rolled relative to pelvis-Z, so a few pixels of difference is expected and
// accepted; anything large would mean the orientation is actually wrong.
console.log(worst2 < 8
  ? `OK: orientation survives OrbitControls (roll difference ${worst2.toFixed(1)} px, ` +
    `from using pelvis +Z as up)`
  : `BROKEN by lookAt: worst ${worst2.toFixed(1)} px`)
process.exit(worst < 1 && worst2 < 8 ? 0 : 1)
