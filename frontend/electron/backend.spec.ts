import { describe, expect, it } from 'vitest'

import { buildBackendCommand, packagedBackendBinary } from './backend.mjs'

describe('electron backend command', () => {
  it('uses config file argument and respects explicit binary path', () => {
    const command = buildBackendCommand({
      backendBinary: '/tmp/novelfabric-backend',
      backendConfig: '/tmp/backend.toml',
    }, false)

    expect(command.command).toBe('/tmp/novelfabric-backend')
    expect(command.args).toEqual(['--config', '/tmp/backend.toml'])
  })

  it('uses packaged backend path when packaged', () => {
    const command = buildBackendCommand({ backendBinary: '', backendConfig: '/tmp/backend.toml' }, true)
    expect(command.command).toContain('backend')
    expect(command.command).toContain(process.platform === 'win32' ? 'novelfabric-backend.exe' : 'novelfabric-backend')
  })

  it('computes packaged backend binary from resources path', () => {
    expect(packagedBackendBinary('/resources')).toContain('backend')
  })
})
