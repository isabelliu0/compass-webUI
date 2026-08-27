# compass-webUI

Operator UI for the COMPASS shared-autonomy policy server.

The server lives in a separate repo and owns the API contract

## Quick start

```sh
cp .env.example .env       # point VITE_PROXY_TARGET at the robot desktop
npm install
npm run dev
```

Then open the URL Vite prints. `npm run dev` listens on the LAN, so other
machines can open it too.

On npm 11+ the first install leaves esbuild's postinstall unapproved, and Vite
won't start without it. Approve it once:

```sh
npm install-scripts approve esbuild && npm rebuild esbuild
```

## Talking to the server

Two ways, and the difference is only whether the browser sees one origin or two.

**Dev proxy (default).** Vite forwards `/operator/*` to `VITE_PROXY_TARGET`, so
the browser thinks everything is same-origin. Leave `VITE_API_BASE` unset. No
server-side CORS needed.

**Direct.** Set `VITE_API_BASE=http://<robot-desktop>:9000` and the browser calls
the policy server itself. That is cross-origin, so the server has to be started
with a matching `--cors-origin` (the `serve-dp-steer` compose service already
passes `--cors-origin *`).

Use the proxy while developing; use direct for a deployed build or a tablet.

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
