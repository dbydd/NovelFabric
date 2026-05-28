import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? '50003'
const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? '50004'
const providerPort = process.env.PLAYWRIGHT_LLM_PROVIDER_PORT ?? '50112'

function parsePort(name: string, port: string): number {
  if (!/^\d+$/.test(port)) {
    throw new Error(`${name} must be a numeric TCP port.`)
  }
  const parsed = Number(port)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid TCP port.`)
  }
  return parsed
}

function rejectForbiddenPort(name: string, port: string) {
  if (port === '3000' || port === '8080') {
    throw new Error(`${name} must not use ${port}.`)
  }
}

function assertNovelFabricServicePort(name: string, port: string) {
  rejectForbiddenPort(name, port)
  if (parsePort(name, port) < 50000) {
    throw new Error(`${name} must use a 50000+ NovelFabric service port.`)
  }
}

function assertNovelFabricServiceUrl(name: string, url: string) {
  const port = new URL(url).port
  if (!port) {
    throw new Error(`${name} must include an explicit 50000+ NovelFabric service port.`)
  }
  assertNovelFabricServicePort(name, port)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}


function safePlaywrightDataDir(port: string): string {
  const fallback = path.join(os.tmpdir(), `novelfabric-playwright-data-${port}`)
  const candidate = path.resolve(process.env.PLAYWRIGHT_DATA_DIR ?? fallback)
  const safeRoot = path.resolve(os.tmpdir())
  const relative = path.relative(safeRoot, candidate)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('PLAYWRIGHT_DATA_DIR must resolve inside the OS temp directory.')
  }
  const basename = path.basename(candidate)
  if (!basename.startsWith('novelfabric-playwright-data-')) {
    throw new Error('PLAYWRIGHT_DATA_DIR must be a novelfabric-playwright-data-* directory.')
  }
  return candidate
}

assertNovelFabricServicePort('PLAYWRIGHT_BACKEND_PORT', backendPort)
assertNovelFabricServicePort('PLAYWRIGHT_FRONTEND_PORT', frontendPort)
assertNovelFabricServicePort('PLAYWRIGHT_LLM_PROVIDER_PORT', providerPort)

const backendUrl = process.env.PLAYWRIGHT_API_BASE ?? `http://127.0.0.1:${backendPort}`
const frontendUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${frontendPort}`
assertNovelFabricServiceUrl('PLAYWRIGHT_API_BASE', backendUrl)
assertNovelFabricServiceUrl('PLAYWRIGHT_BASE_URL', frontendUrl)
const providerUrl = `http://127.0.0.1:${providerPort}`
process.env.PLAYWRIGHT_API_BASE ??= backendUrl
process.env.PLAYWRIGHT_BASE_URL ??= frontendUrl
process.env.PLAYWRIGHT_LLM_PROVIDER_BASE ??= `${providerUrl}/v1`
const dataDir = safePlaywrightDataDir(backendPort)
const cargoBin = process.env.NOVELFABRIC_CARGO ?? 'cargo'
const backendCommand = [
  'node',
  '-e',
  shellQuote("const fs=require('node:fs'); const dir=process.argv[1]; fs.rmSync(dir,{recursive:true,force:true}); fs.mkdirSync(dir,{recursive:true});"),
  shellQuote(dataDir),
  '&&',
  shellQuote(cargoBin),
  'run',
  '--manifest-path',
  shellQuote('../backend/Cargo.toml'),
  '--bin',
  'novelfabric-backend',
  '--',
  '--bind-address',
  shellQuote(`127.0.0.1:${backendPort}`),
  '--data-dir',
  shellQuote(dataDir),
].join(' ')

export default defineConfig({
  testDir: './e2e-fullstack',
  timeout: 60 * 1000,
  expect: { timeout: 10_000 },
  reporter: 'line',
  workers: 1,
  webServer: [
    {
      command: `bash -lc ${JSON.stringify(backendCommand)}`,
      url: `${backendUrl}/health`,
      timeout: 120 * 1000,
      reuseExistingServer: false,
    },
    {
      command: `python3 e2e-fullstack/support/local-llm-provider.py ${shellQuote(providerPort)}`,
      url: `${providerUrl}/health`,
      timeout: 30 * 1000,
      reuseExistingServer: false,
    },
    {
      command: `VITE_API_BASE=${shellQuote(backendUrl)} npx vite --host 127.0.0.1 --port ${shellQuote(frontendPort)}`,
      url: frontendUrl,
      timeout: 60 * 1000,
      reuseExistingServer: false,
    },
  ],
  use: {
    baseURL: frontendUrl,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
