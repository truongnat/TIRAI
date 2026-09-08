import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testIgnore: ['.tirai/**', 'node_modules/**', 'test-results/**', '.vercel/**', '.output/**'],
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
