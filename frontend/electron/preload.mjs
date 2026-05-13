import { contextBridge } from 'electron'

const argument = process.argv.find((value) => value.startsWith('--novelfabric-api-base='))
const apiBaseUrl = argument?.slice('--novelfabric-api-base='.length) ?? 'http://127.0.0.1:50000'

contextBridge.exposeInMainWorld('novelfabricDesktop', {
  apiBaseUrl,
})
