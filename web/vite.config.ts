import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const server = 'http://localhost:' + (process.env.PORT ?? 8787)

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  // Trailing slashes: these are prefix matches, and '/api' would also swallow the module /api.ts.
  server: { proxy: { '/api/': server, '/auth/': server, '/files/': server } },
})
