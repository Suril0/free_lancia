import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/healthz": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: process.env.API_URL ?? "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
