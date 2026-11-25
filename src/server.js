import 'dotenv/config'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { createApp, describeRuntime } from './app.js'
import { openStore } from './storage/index.js'
import { openFiles } from './files.js'
import { createMailer } from './email.js'
import { adminPassword, loadFileSecret } from './auth.js'
import { BOOTSTRAP_EMAIL, ensureBootstrapAdmin } from './users.js'

const dataDir = path.resolve(process.env.DATA_DIR || './data')
const password = adminPassword()
const adminEmail = process.env.ADMIN_EMAIL || BOOTSTRAP_EMAIL
const store = await openStore()
await ensureBootstrapAdmin(store, { email: adminEmail, password, name: 'Admin' })
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
console.log(`Form: ${where}/   Big screen: ${where}/spin   Admin: ${where}/admin`)
console.log(`Entries: ${runtime.storage}`)
console.log(`Proof files: ${runtime.proofs}`)
console.log(`Email: ${runtime.email}`)
console.log(`Bootstrap admin: ${adminEmail}`)
