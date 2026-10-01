import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

export default defineConfig(() => {
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
      proxy: {
        '/.netlify/functions': {
          target: 'http://127.0.0.1:9999',
          changeOrigin: true,
        },
      },
    },
  }
})
