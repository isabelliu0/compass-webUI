import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In dev we proxy /operator to the policy server, so the browser sees a single
// origin and CORS never applies. Point a build at another host instead by
// setting VITE_API_BASE, which does require the server's --cors-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const target = env.VITE_PROXY_TARGET || 'http://10.40.18.80:9000'

  return {
    plugins: [react()],
    server: {
      host: true, // listen on the LAN so other machines can open the dev server
      proxy: {
        '/operator': { target, changeOrigin: true },
      },
    },
  }
})
