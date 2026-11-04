import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Identifica o build (aparece em Configurações → "Versão do app").
const sha = (process.env.GITHUB_SHA || '').slice(0, 7)
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
const build = sha ? `${stamp} UTC · ${sha}` : `${stamp} UTC`

export default defineConfig({
  plugins: [react()],
  base: './',
  define: { __BUILD__: JSON.stringify(build) },
})
