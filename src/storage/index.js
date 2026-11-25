import path from 'node:path'
import { LocalStore } from './local.js'
import { SheetsStore, sheetsConfigured } from './sheets.js'

export async function openStore() {
  if (sheetsConfigured()) {
    const store = new SheetsStore()
    await store.ready()
    return store
  }
  const dir = path.resolve(process.env.DATA_DIR || './data')
  const store = new LocalStore(dir)
  await store.ready()
  return store
}

export { sheetsConfigured }
