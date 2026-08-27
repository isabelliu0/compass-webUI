# compass-webUI

Operator UI for the COMPASS shared-autonomy policy server.

The server lives in a separate repo and owns the API contract.

| Machine | What runs there |
| --- | --- |
| robot desktop | policy server (`:9000`), policy runner, and this dev server (`:5173`) |
| device | just a browser |

That's the point of the dev proxy: Vite serves the page *and* relays the API
calls, both on port 5173, so a viewing device never talks to port 9000 itself.

## Setup — robot desktop, once

```sh
export PATH="$HOME/.local/opt/node/bin:$PATH"   # add to ~/.bashrc
cp .env.example .env                            # set VITE_PROXY_TARGET to this desktop's IP
npm install
```

If `npm run dev` later fails with an esbuild error, approve its postinstall once
(usually unnecessary — the prebuilt binary ships in `@esbuild/<platform>`):

```sh
npm install-scripts approve esbuild && npm rebuild esbuild
```

## Every session — robot desktop, three terminals

```sh
# 1. policy server            (in physicaltab/)
docker compose up -d serve-dp-steer

# 2. policy runner            (inside the `manipulation` container)
python3 /ros2_ws/src/manipulation_pkg/presence/policy_runner_dp.py \
    --mode predict --server_url http://127.0.0.1:9000 --frequency 20

# 3. this UI                  (here)
npm run dev
```

`--server_url` matters — the runner's own default is `:8001`, not `:9000`.

Robot bring-up itself (`make manipulation`, the safety controller, and
`waist_mode_sender.py fix`) is unchanged and documented in `humanoid-monorepo`.
Don't skip the waist fix: every trajectory drawn here is projected through an
extrinsic that's only valid while the waist is pinned.

## Opening it

| From | URL |
| --- | --- |
| the robot desktop | `http://localhost:5173` |
| another device on the same network | `http://<robot-desktop-ip>:5173` |

**Nothing to install on the other device.** No clone, no Node, no config — it is
only requesting a web page from the desktop. Use the desktop's IP, not
`localhost`, which on your laptop means your laptop.

Two requirements: the desktop keeps `npm run dev` running, and both machines are
on the same network. (On this setup that's the WiFi address — the
`192.168.123.x` interface is the robot's private network.)

If the page won't load from another device, check that `npm run dev` is still up,
that you're on the same WiFi, and that the desktop firewall allows 5173. A useful
split test: the policy server also ships a zero-dependency reference client at
`http://<robot-desktop-ip>:9000/operator`. If that loads and `:5173` doesn't, the
problem is the firewall or the dev server, not the network.

### If it shows `idle`

Server state only advances while the policy runner is streaming to `/predict`.
`phase: idle`, `menu_epoch` frozen at 0, and a 404 on `/operator/frame` all mean
step 2 isn't running. The UI is fine; nothing is driving the loop.

## Talking to the server

Browsers enforce the same-origin policy, where an origin is scheme + host +
port. A page at `http://localhost:5173` calling `http://10.40.18.80:9000` is
cross-origin, and the browser will refuse to hand the response to JavaScript
unless the server opts in with CORS headers.

**Dev proxy — the default.** `VITE_API_BASE` is unset, so the app fetches
relative URLs like `/operator/state`. Those resolve against the page's own
origin, so the browser is only ever talking to the Vite dev server. Vite then
forwards the request to `VITE_PROXY_TARGET` and pipes the response back. Vite is
a server, not a browser, so no same-origin policy applies to that second hop.

```
browser ──/operator/state──> vite :5173 ──> policy server :9000
          (same origin, no CORS)            (server-to-server)
```

**Direct.** Set `VITE_API_BASE=http://<robot-desktop>:9000` and the app fetches
absolute URLs, so the browser calls the policy server itself. That is
cross-origin, and the server must send matching CORS headers — start it with
`--cors-origin` (the `serve-dp-steer` compose service already passes
`--cors-origin *`). The `POST`s also trigger a preflight `OPTIONS` first,
because they send `Content-Type: application/json`.

```
browser ──/operator/state──> policy server :9000
          (cross-origin: needs --cors-origin)
```

Which to use:

| | Dev proxy | Direct |
| --- | --- | --- |
| Server CORS config | not needed | required |
| Needs Node running | yes | no — static files, any host |
| Network hops | two | one |
| Good for | developing | a deployed build, a tablet, an HMD |

There's a third case that needs neither: serve the built `dist/` from the policy
server itself, and it's same-origin again.

## Types are generated, not hand-written

`src/api/types.ts` is generated from `openapi.json`, which the policy server
publishes. Don't edit it. To pick up a server-side contract change:

```sh
curl -s http://<robot-desktop>:9000/openapi.json > openapi.json
npm run codegen
npm run typecheck
```

`npm run codegen` runs `scripts/gen-types.py` — deliberately Python rather than
`openapi-typescript`, so regenerating needs no extra toolchain. The server's
field descriptions come through as JSDoc, so the contract's fiddly bits show up
in editor tooltips.

## Layout

```
openapi.json            contract snapshot; regenerate from the server
scripts/gen-types.py    openapi.json -> src/api/types.ts
src/api/                types (generated), fetch client, polling hook
src/render/project.ts   pelvis metres -> pixels, and time-correct sampling
src/components/         CameraView, ModeMenu, StatusBar
```
