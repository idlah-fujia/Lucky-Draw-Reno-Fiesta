import 'dotenv/config'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp, describeRuntime } from './app.js'
import { openStore } from './storage/index.js'
import { openFiles } from './files.js'
import { createMailer } from './email.js'
import { adminPassword, loadFileSecret } from './auth.js'
import { BOOTSTRAP_EMAIL, ensureBootstrapAdmin } from './users.js'
import { isSheetQuota } from './storage/sheets.js'
import { sleep } from './sheetHeader.js'

const dataDir = path.resolve(process.env.DATA_DIR || './data')
const password = adminPassword()
const adminEmail = process.env.ADMIN_EMAIL || BOOTSTRAP_EMAIL
const store = await openStore()
let retrySheet = !store.loaded
try {
  await ensureBootstrapAdmin(store, { email: adminEmail, password, name: 'Admin' })
} catch (error) {
  if (!isSheetQuota(error)) throw error
  retrySheet = true
  console.error('Could not check the bootstrap admin yet. Will retry.')
}
if (retrySheet) void resumeSheet(store, adminEmail, password)
const files = openFiles()
await files.ready()
const mailer = createMailer(dataDir)
const app = createApp({
  store,
  files,
  mailer,
  adminPassword: password,
  fileSecret: loadFileSecret(dataDir),
  allowForcePrize: process.env.ALLOW_FORCE_PRIZE === '1'
})

const port = Number(process.env.PORT || 47231)
const hostname = process.env.HOST || '0.0.0.0'
const server = serve({ fetch: app.fetch, port, hostname })
server.keepAliveTimeout = 120_000
server.headersTimeout = 125_000

const where = `http://${hostname === '0.0.0.0' ? '127.0.0.1' : hostname}:${port}`
const runtime = describeRuntime({ store, files, mailer })
console.log(`Sure-Win Spin is running at ${where}`)
console.log(`On-site: ${where}/events   After event: ${where}/virtual   Admin: ${where}/admin`)
console.log(`Entries: ${runtime.storage}`)
console.log(`Proof files: ${runtime.proofs}`)
console.log(`Email: ${runtime.email}`)
console.log(`Bootstrap admin: ${adminEmail}`)

async function resumeSheet(store, email, password) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(10_000)
    try {
      if (!store.loaded) await store.ready()
      await ensureBootstrapAdmin(store, { email, password, name: 'Admin' })
      console.log('Google Sheet is ready.')
      return
    } catch (error) {
      if (!isSheetQuota(error)) {
        console.error(error)
        return
      }
      console.error('Google Sheet is still rate limited.')
    }
  }
}
