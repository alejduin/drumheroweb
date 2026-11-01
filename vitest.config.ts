import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
      '@pwa': resolve(__dirname, 'pwa'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Los tests nunca hablan con el Supabase real aunque exista .env.local
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
    // Sin esto Vitest vacía los .css; el test de paridad de tokens lee theme.css?raw
    css: { include: [/theme\.css/] },
  },
})
