import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

export default defineConfig(({ mode }) => {
  const env = {
    ...process.env,
    ...loadEnv(mode, process.cwd(), ''),
  }

  return {
    define: {
      __TURSO_URL__: JSON.stringify(env.TURSO_URL || env.VITE_TURSO_URL || ''),
      __TURSO_TOKEN__: JSON.stringify(env.TURSO_TOKEN || env.VITE_TURSO_TOKEN || ''),
    },
    plugins: [
      vue({
        template: { transformAssetUrls },
      }),
      vuetify({
        autoImport: true,
      }),
    ],
  }
})
