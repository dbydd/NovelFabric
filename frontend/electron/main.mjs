import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeFile } from 'node:fs/promises'

import { loadDesktopConfig } from './config.mjs'
import { startBackend } from './backend.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let backendProcess = null

async function createWindow() {
  const config = await loadDesktopConfig()
  await ensureBackendConfig(config)
  backendProcess = startBackend(config)

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.mjs'),
      additionalArguments: [`--novelfabric-api-base=${config.apiBaseUrl}`]
    },
    title: 'NovelFabric',
    icon: path.join(__dirname, '..', 'build', 'icons', 'icon-app.svg')
  })

  await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})


async function ensureBackendConfig(config) {
  const content = `data_dir = "${config.dataDir ?? 'data'}"

[server]
bind_address = "${new URL(config.apiBaseUrl).hostname}:${new URL(config.apiBaseUrl).port || '50000'}"
`
  await writeFile(config.backendConfig, content, { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') {
      throw error
    }
  })
}
