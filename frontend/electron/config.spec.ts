import { describe, expect, it } from 'vitest'

import { getConfigDir } from './config.mjs'

describe('desktop config dir', () => {
  it('uses ~/.config/novelfabric on linux without XDG override', () => {
    expect(getConfigDir('linux', {}, '/home/alice')).toBe('/home/alice/.config/novelfabric')
  })

  it('uses XDG_CONFIG_HOME on linux when present', () => {
    expect(getConfigDir('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/alice')).toBe('/xdg/novelfabric')
  })

  it('uses APPDATA on windows', () => {
    expect(getConfigDir('win32', { APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' }, 'C:\\Users\\alice')).toContain('novelfabric')
  })
})
