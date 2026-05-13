import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function defaultBackendBinary() {
  const exe = process.platform === 'win32' ? 'novelfabric-backend.exe' : 'novelfabric-backend'
  return path.resolve(__dirname, '..', '..', 'backend', 'target', 'debug', exe)
}

export function packagedBackendBinary(resourcesPath = process.resourcesPath ?? path.resolve(__dirname, '..', 'dist', 'resources')) {
  const exe = process.platform === 'win32' ? 'novelfabric-backend.exe' : 'novelfabric-backend'
  return path.join(resourcesPath, 'backend', exe)
}

export function buildBackendCommand(config, packaged = process.defaultApp === false) {
  return {
    command: config.backendBinary || (packaged ? packagedBackendBinary() : defaultBackendBinary()),
    args: ['--config', config.backendConfig]
  }
}

export function startBackend(config) {
  const command = buildBackendCommand(config)
  return spawn(command.command, command.args, {
    stdio: 'ignore',
    detached: false
  })
}
