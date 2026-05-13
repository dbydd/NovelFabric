import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function getConfigDir(platform = process.platform, env = process.env, homedir = os.homedir()) {
  if (platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming'), 'novelfabric')
  }
  const xdg = env.XDG_CONFIG_HOME
  if (xdg) {
    return path.join(xdg, 'novelfabric')
  }
  return path.join(homedir, '.config', 'novelfabric')
}

export function getConfigPath() {
  return path.join(getConfigDir(), 'desktop.json')
}

export async function loadDesktopConfig() {
  const configPath = getConfigPath()
  try {
    const content = await readFile(configPath, 'utf8')
    return JSON.parse(content)
  } catch {
    const defaults = {
      backendBinary: '',
      backendConfig: path.join(getConfigDir(), 'backend.toml'),
      apiBaseUrl: 'http://127.0.0.1:50000',
      dataDir: path.join(getConfigDir(), 'data')
    }
    await writeDesktopConfig(defaults)
    return defaults
  }
}

export async function writeDesktopConfig(config) {
  const configDir = getConfigDir()
  await mkdir(configDir, { recursive: true })
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2))
}
