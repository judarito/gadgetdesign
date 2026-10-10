import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

export default defineConfig(() => {
  const functionsPort = Number(process.env.NETLIFY_FUNCTIONS_PORT || 9999)

  return {
    plugins: [
      vue({
        template: { transformAssetUrls },
      }),
      vuetify({
        autoImport: true,
      }),
    ],
    server: {
      port: Number(process.env.VITE_PORT || 5173),
      strictPort: true,
      proxy: {
        '/.netlify/functions': {
          target: `http://127.0.0.1:${functionsPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
