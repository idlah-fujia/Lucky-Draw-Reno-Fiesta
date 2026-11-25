import path from 'node:path'
import { LocalStore } from './local.js'
import { SheetsStore, isSheetQuota, sheetsConfigured } from './sheets.js'

export async function openStore() {
  if (sheetsConfigured()) {
    const store = new SheetsStore()
    try {
      await store.ready()
    } catch (error) {
      if (!isSheetQuota(error)) throw error
      console.error('Google Sheets read quota was hit while opening entries. The server will keep trying.')
    }
    return store
  }
  const dir = path.resolve(process.env.DATA_DIR || './data')
  const store = new LocalStore(dir)
  await store.ready()
  return store
}

export { sheetsConfigured }
