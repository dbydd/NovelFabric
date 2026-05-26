import { defineConfig, devices } from '@playwright/test'

const backendPort = 50090
const frontendPort = 5174
const dataDir = process.env.NOVELFABRIC_E2E_DATA_DIR ?? '/tmp/novelfabric-fullstack-e2e-data'

export default defineConfig({
  testDir: './e2e-fullstack',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    headless: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `cargo run --manifest-path ../backend/Cargo.toml --bin novelfabric-backend -- --bind-address 127.0.0.1:${backendPort} --data-dir ${dataDir}`,
      port: backendPort,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `VITE_API_BASE=http://127.0.0.1:${backendPort} npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
      port: frontendPort,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
