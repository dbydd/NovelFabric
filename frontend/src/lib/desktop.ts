export interface NovelFabricDesktopBridge {
  apiBaseUrl?: string
}

declare global {
  interface Window {
    novelfabricDesktop?: NovelFabricDesktopBridge
  }
}

export function desktopApiBase(): string | undefined {
  return globalThis.window?.novelfabricDesktop?.apiBaseUrl
}
