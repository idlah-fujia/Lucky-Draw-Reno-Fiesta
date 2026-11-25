import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createApp } from '../src/app.js'
import { eventFromCells, eventNeedsDateBackfill, eventSheetColumns, formatEventRange } from '../src/events.js'
import { getConfig } from '../src/config.js'
import { LocalStore } from '../src/storage/local.js'
import { LocalFiles } from '../src/files.js'
import { todaySGT } from '../src/http.js'
import { formatCode } from '../src/codes.js'
import { envKioskQr } from '../src/kioskQr.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function testConfig() {
  return {
    whatsapp: '6588949268',
    kioskResetSeconds: 120,
    invalidResetSeconds: 12,
    idleResetSeconds: 90,
    events: [
      { slug: 'reno-fiesta-nov-2026', name: 'Reno Fiesta', edition: 'November 2026', starts: '2020-01-01', ends: '2035-12-31', active: true },
      { slug: 'closed-fest', name: 'Closed Fest', edition: 'Old', starts: '2020-01-01', ends: '2020-01-02', active: false }
    ],
    prizes: [
      { id: 'GRAB40', brand: 'Grab', label: '$40 Grab voucher', weight: 50 },
      { id: 'IPHONE', brand: 'Apple', label: 'iPhone Duo or iPhone 18 Pro Max', weight: 1, oncePerEvent: true }
    ],
    slots: Array.from({ length: 32 }, (_, index) => (index === 8 ? 'IPHONE' : 'GRAB40'))
  }
}

function mailer() {
  const records = []
  return {
    mode: 'log',
    records,
    async send(message) {
      const record = { ...message, id: String(records.length + 1), at: new Date().toISOString(), status: 'logged', error: '' }
      records.push(record)
      return record
    },
    async recent() { return records.slice().reverse() }
  }
}

async function build(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spin-'))
  const store = new LocalStore(dir)
  await store.ready()
  const files = new LocalFiles(path.join(dir, 'uploads'))
  await files.ready()
  const sent = mailer()
  const app = createApp({
    store,
    files,
    mailer: sent,
    getConfig: testConfig,
    adminPassword: 'test-password-1',
    fileSecret: 'test-secret',
    allowForcePrize: true,
    siteMode: options.siteMode
  })
  const { ensureBootstrapAdmin } = await import('../src/users.js')
  await ensureBootstrapAdmin(store, { email: 'admin@renofiesta.sg', password: 'test-password-1', name: 'Admin' })
  return { app, store, sent, dir }
}

function entryForm(overrides = {}) {
  const data = new FormData()
  const fields = {
    event_slug: 'reno-fiesta-nov-2026',
    event_date: todaySGT(),
    homeowner_name: 'Mei Lin Tan',
    homeowner_phone: '81234567',
    homeowner_email: 'Mei@Example.com',
    decl_contract: 'yes',
    decl_genuine: 'yes',
    decl_verify: 'yes',
    tnc: 'yes',
    designer_name: 'Alicia Ong',
    designer_phone: '62345678',
    designer_email: 'alicia@studio.example',
    id_company: 'Studio Example',
    ...overrides
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || key === 'proof') continue
    data.set(key, value)
  }
  const file = overrides.proof === null ? null : new File([png], 'receipt.png', { type: 'image/png' })
  if (file) data.set('proof', file)
  return data
}

async function json(res) {
  const body = await res.json()
  return { status: res.status, body }
}

test('submit, designer, one spin, then the same code shows the prize', async () => {
  const { app, sent, store } = await build()
  const created = await json(await app.request('/api/entries', { method: 'POST', body: entryForm() }))
  assert.equal(created.status, 200)
  assert.equal(created.body.code.length, 8)
  const saved = (await store.list()).find((row) => row.code === created.body.code)
  assert.equal(saved.delivery_address, '')
  assert.equal(created.body.email, 'mei@example.com')
  assert.equal(created.body.emailStatus, 'logged')
  assert.equal(sent.records.length, 1)
  assert.equal(sent.records[0].to, 'mei@example.com')
  assert.match(sent.records[0].text, /phone to spin|big screen/)
  assert.match(sent.records[0].text, new RegExp(formatCode(created.body.code)))
  assert.doesNotMatch(sent.records[0].text, /undefined/)
  assert.equal(sent.records.some((record) => record.to === 'alicia@studio.example'), false)

  const dup = await json(await app.request('/api/entries', { method: 'POST', body: entryForm() }))
  assert.equal(dup.status, 409)

  const samePhone = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ homeowner_phone: '82345678', designer_phone: '82345678', homeowner_email: 'other@example.com' })
  }))
  assert.equal(samePhone.status, 400)

  const bare = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({
      homeowner_phone: '83345678',
      homeowner_email: 'bare@example.com',
      designer_name: null,
      designer_phone: null,
      designer_email: null,
      id_company: null
    })
  }))
  assert.equal(bare.status, 400)

  const old = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ homeowner_phone: '84345678', homeowner_name: 'Old Entry', homeowner_email: 'old@example.com' })
  }))
  assert.equal(old.status, 200, old.body.error)
  await store.transaction((list) => {
    const row = list.find((item) => item.code === old.body.code)
    row.designer_name = ''
    row.designer_phone = ''
    row.designer_email = ''
    row.id_company = ''
    row.designer_saved_at = ''
  })
  const blockedSpin = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: old.body.code, event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(blockedSpin.status, 400)
  assert.match(blockedSpin.body.error, /designer/i)
  const blockedLookup = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: old.body.code, event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(blockedLookup.body.state, 'needs_designer')
  assert.equal(blockedLookup.body.canContinue, false)

  const noEvent = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code })
  }))
  assert.equal(noEvent.status, 400)

  const lookup = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: `${created.body.code.slice(0, 4)} ${created.body.code.slice(4)}`, event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(lookup.status, 200)
  assert.equal(lookup.body.state, 'ready')
  assert.equal(lookup.body.canContinue, true)
  assert.equal(lookup.body.firstName, 'Mei')
  assert.equal(lookup.body.designer.name, 'Alicia Ong')
  assert.equal(lookup.body.homeowner_phone, undefined)

  const spun = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, event: 'reno-fiesta-nov-2026', forcePrize: 'GRAB40' })
  }))
  assert.equal(spun.status, 200)
  assert.equal(spun.body.result.prizeId, 'GRAB40')
  assert.equal(spun.body.result.slot >= 0, true)
  assert.equal(spun.body.already, false)
  assert.equal(sent.records.length, 4)
  assert.equal(sent.records.filter((record) => record.to === 'alicia@studio.example').length, 1)
  assert.equal(sent.records.filter((record) => record.to === 'mei@example.com').length, 2)
  assert.equal(sent.records.some((record) => /delivery address/i.test(record.text + record.html)), false)

  const again = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(again.body.state, 'spun')
  assert.equal(again.body.canContinue, false)
  assert.equal(again.body.result.label, '$40 Grab voucher')

  const secondSpin = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, event: 'reno-fiesta-nov-2026', forcePrize: 'IPHONE' })
  }))
  assert.equal(secondSpin.body.already, true)
  assert.equal(secondSpin.body.result.prizeId, 'GRAB40')
  assert.equal(sent.records.length, 4)
})

test('iphone can be won once, a void frees it, and admin can export', async () => {
  const { app } = await build()
  async function signup(phone, name) {
    const created = await json(await app.request('/api/entries', {
      method: 'POST',
      body: entryForm({ homeowner_phone: phone, homeowner_name: name, homeowner_email: `${phone}@example.com` })
    }))
    assert.equal(created.status, 200, created.body.error)
    return created.body.code
  }
  const first = await signup('81234567', 'Mei Lin')
  const won = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: first, event: 'reno-fiesta-nov-2026', forcePrize: 'IPHONE' })
  }))
  assert.equal(won.body.result.prizeId, 'IPHONE')
  assert.equal(won.body.result.slot, 8)

  const second = await signup('82345678', 'Ben Koh')
  const blocked = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: second, event: 'reno-fiesta-nov-2026', forcePrize: 'IPHONE' })
  }))
  assert.equal(blocked.status, 409)

  const login = await app.request('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@renofiesta.sg', password: 'test-password-1' })
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const denied = await app.request('/api/admin/entries')
  assert.equal(denied.status, 401)
  const list = await json(await app.request('/api/admin/entries', { headers: { cookie } }))
  const iphone = list.body.entries.find((row) => row.code === first)
  assert.equal(iphone.prize_id, 'IPHONE')
  assert.ok(iphone.proof_link.includes('/proof/'))
  const file = await app.request(new URL(iphone.proof_link).pathname)
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'image/png')

  const csvRes = await app.request('/api/admin/entries.csv', { headers: { cookie } })
  const csv = await csvRes.text()
  assert.match(csv, new RegExp(first))
  assert.match(csv, /Mei Lin/)
  assert.match(csv, /Alicia Ong/)
  assert.match(csv, /Studio Example/)

  const voided = await json(await app.request(`/api/admin/entries/${iphone.id}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'void' })
  }))
  assert.equal(voided.body.entry.status, 'voided')
  const afterVoid = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: first, event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(afterVoid.body.state, 'voided')
  assert.equal(afterVoid.body.canContinue, false)

  const third = await signup('81234567', 'Mei Again')
  const rewon = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: third, event: 'reno-fiesta-nov-2026', forcePrize: 'IPHONE' })
  }))
  assert.equal(rewon.status, 200)
  assert.equal(rewon.body.result.prizeId, 'IPHONE')
})

test('bad proof, future date, and a code for another screen are rejected', async () => {
  const { app } = await build()
  const text = new FormData()
  text.set('event_slug', 'reno-fiesta-nov-2026')
  text.set('event_date', todaySGT())
  text.set('homeowner_name', 'Mei Lin')
  text.set('homeowner_phone', '81234567')
  text.set('homeowner_email', 'mei@example.com')
  text.set('decl_contract', 'yes')
  text.set('decl_genuine', 'yes')
  text.set('decl_verify', 'yes')
  text.set('tnc', 'yes')
  text.set('proof', new File([Buffer.from('hello this is not a real document at all')], 'notes.txt', { type: 'text/plain' }))
  const bad = await json(await app.request('/api/entries', { method: 'POST', body: text }))
  assert.equal(bad.status, 400)

  const future = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ event_date: '2035-12-30' })
  }))
  assert.equal(future.status, 400)

  const created = await json(await app.request('/api/entries', { method: 'POST', body: entryForm() }))
  const wrongScreen = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, event: 'homefest-2026' })
  }))
  assert.equal(wrongScreen.status, 409)
  assert.equal(wrongScreen.body.canContinue, undefined)
})

test('two spins at once cannot both take the iPhone', async () => {
  const { app } = await build()
  async function readyCode(phone) {
    const created = await json(await app.request('/api/entries', {
      method: 'POST',
      body: entryForm({ homeowner_phone: phone, homeowner_name: `Home ${phone}`, homeowner_email: `${phone}@example.com` })
    }))
    assert.equal(created.status, 200, created.body.error)
    return created.body.code
  }
  const codes = await Promise.all(['81000001', '81000002', '81000003', '81000004'].map(readyCode))
  const results = await Promise.all(codes.map(async (code) => json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, event: 'reno-fiesta-nov-2026', forcePrize: 'IPHONE' })
  }))))
  const awarded = results.filter((result) => result.status === 200 && result.body.result?.prizeId === 'IPHONE')
  assert.equal(awarded.length, 1)
  const lookup = await json(await app.request('/api/spin/lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: codes[0], event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(lookup.body.iphoneRedeemed, true)
  assert.deepEqual(lookup.body.soldOut, ['IPHONE'])
  const blocked = results.filter((result) => result.status === 409)
  assert.equal(blocked.length, 3)
  assert.match(blocked[0].body.error, /fully redeemed/i)
})

test('the phone form lists events, and the server keeps the date inside that event', async () => {
  const { app } = await build()
  const home = await app.request('/', { redirect: 'manual' })
  assert.equal(home.status, 302)
  assert.equal(home.headers.get('location'), '/events')
  const form = await app.request('/events/e/reno-fiesta-nov-2026')
  const html = await form.text()
  assert.equal(form.status, 200)
  assert.match(html, /id="eventSlot"/)
  assert.match(html, /id="dateSlot"/)
  assert.match(html, /data-testid="step-designer"/)
  assert.match(html, /iphone-duo\.webp/)
  assert.match(html, /iphone-18-pro-max\.webp/)
  assert.match(html, /data-testid="next-step"/)
  assert.doesNotMatch(html, /You’ll spin this on the big screen/)
  assert.doesNotMatch(html, /walk to the LED screen/)
  assert.doesNotMatch(html, /id="wheel"/)
  assert.doesNotMatch(html, /wheel\.js/)
  assert.match(html, /Submit &amp; get my spin code/)
  assert.doesNotMatch(html, /Filled in by the homeowner/i)
  assert.doesNotMatch(html, /within 2 weeks|within 14 days|Delivered in 2 weeks/i)
  assert.match(html, /within 30 days/)
  assert.doesNotMatch(html, /type="date"/)
  const register = await app.request('/events/register')
  assert.equal(register.status, 200)
  assert.match(await register.text(), /id="eventSlot"/)

  const early = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ event_date: '2019-06-01' })
  }))
  assert.equal(early.status, 400)
  assert.match(early.body.error, /before the event/)

  const unknown = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ event_slug: 'no-such-event' })
  }))
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.error, /event/i)
})

test('kiosk QR uses the event form URL, and admin can save size and position', async () => {
  const { app } = await build()
  const headers = { host: 'lucky-draw-reno-fiesta.onrender.com', 'x-forwarded-proto': 'https' }
  const base = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://lucky-draw-reno-fiesta.onrender.com').replace(/\/$/, '')
  const fallback = envKioskQr()

  const display = await json(await app.request('/api/kiosk/display?event=reno-fiesta-nov-2026', { headers }))
  assert.equal(display.status, 200)
  assert.equal(display.body.event.slug, 'reno-fiesta-nov-2026')
  assert.equal(display.body.formUrl, `${base}/virtual`)
  assert.equal(display.body.qr.size, fallback.size)
  assert.equal(display.body.qr.position, fallback.position)

  const bare = await json(await app.request('/api/kiosk/display', { headers }))
  assert.equal(bare.body.event.slug, 'reno-fiesta-nov-2026')
  assert.equal(bare.body.formUrl, `${base}/virtual`)
  const onSite = await json(await app.request('/api/kiosk/display?event=reno-fiesta-nov-2026&mount=events', { headers }))
  assert.equal(onSite.body.formUrl, `${base}/events`)

  const png = await app.request('/api/kiosk/qr.png?event=reno-fiesta-nov-2026', { headers })
  assert.equal(png.status, 200)
  assert.equal(png.headers.get('content-type'), 'image/png')
  const bytes = Buffer.from(await png.arrayBuffer())
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')

  const missing = await json(await app.request('/api/kiosk/display?event=no-such-event'))
  assert.equal(missing.status, 404)

  const denied = await app.request('/api/admin/kiosk-qr', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(denied.status, 401)

  const login = await app.request('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@renofiesta.sg', password: 'test-password-1' })
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const bad = await json(await app.request('/api/admin/kiosk-qr', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'reno-fiesta-nov-2026', size: 5, unit: 'percent', position: 'top-center' })
  }))
  assert.equal(bad.status, 400)

  const saved = await json(await app.request('/api/admin/kiosk-qr', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'closed-fest', size: 220, unit: 'px', position: 'top-left' })
  }))
  assert.equal(saved.status, 200, saved.body.error)
  const closed = await json(await app.request('/api/kiosk/display?event=closed-fest'))
  assert.equal(closed.body.qr.size, 220)
  assert.equal(closed.body.qr.unit, 'px')
  assert.equal(closed.body.qr.position, 'top-left')
  assert.equal(closed.body.qr.source, 'event')
  assert.equal(closed.body.formUrl.endsWith('/virtual'), true)

  const global = await json(await app.request('/api/admin/kiosk-qr', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ event: '', size: 40, unit: 'percent', position: 'bottom-center' })
  }))
  assert.equal(global.status, 200)
  const reno = await json(await app.request('/api/kiosk/display?event=reno-fiesta-nov-2026'))
  assert.equal(reno.body.qr.size, 40)
  assert.equal(reno.body.qr.position, 'bottom-center')
  assert.equal(reno.body.qr.source, 'global')
  const still = await json(await app.request('/api/kiosk/display?event=closed-fest'))
  assert.equal(still.body.qr.position, 'top-left')

  const page = await app.request('/events/spin?event=reno-fiesta-nov-2026')
  const spinHtml = await page.text()
  assert.match(spinHtml, /id="kioskQr"/)
  assert.match(spinHtml, /Scan to register for your spin/)
  assert.match(spinHtml, />Close</)
})

test('the path picks the version, and only after-event codes open the phone wheel', async () => {
  const { app, store } = await build()
  const root = await app.request('/', { redirect: 'manual' })
  assert.equal(root.headers.get('location'), '/events')
  const led = await app.request('/events')
  assert.equal(led.status, 200)
  const ledHtml = await led.text()
  assert.match(ledHtml, /id="eventSlot"/)
  assert.doesNotMatch(ledHtml, /delivery_address|Prize delivery address/)
  const screen = await app.request('/events/spin')
  assert.equal(screen.status, 200)
  const phone = await app.request('/virtual')
  assert.equal(phone.status, 200)
  const phoneHtml = await phone.text()
  assert.match(phoneHtml, /id="eventSlot"/)
  assert.doesNotMatch(phoneHtml, /delivery_address|Prize delivery address/)
  const pageJs = await (await app.request('/js/page1.js')).text()
  assert.doesNotMatch(pageJs, /delivery_address/)
  const ignored = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({
      homeowner_phone: '84567891',
      homeowner_email: 'addr@example.com',
      designer_phone: '63456781',
      delivery_address: '10 Example Road #04-02 Singapore 123456'
    })
  }))
  assert.equal(ignored.status, 200, ignored.body.error)
  const stored = (await store.list()).find((row) => row.code === ignored.body.code)
  assert.equal(stored.delivery_address, '')
  const oldVirtual = await app.request('/virtual/e/reno-fiesta-nov-2026', { redirect: 'manual' })
  assert.equal(oldVirtual.status, 302)
  assert.equal(oldVirtual.headers.get('location'), '/virtual')
  const oldSpin = await app.request('/spin?event=reno-fiesta-nov-2026', { redirect: 'manual' })
  assert.equal(oldSpin.status, 302)
  assert.match(oldSpin.headers.get('location') || '', /\/events\/spin\?event=reno-fiesta-nov-2026$/)

  const created = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ homeowner_phone: '81231111', homeowner_email: 'after@example.com', mount: 'virtual' })
  }))
  assert.equal(created.status, 200, created.body.error)
  assert.equal(created.body.mode, 'after_event')
  assert.match(created.body.spinUrl, /\/virtual\/spin\?code=/)
  assert.doesNotMatch(created.body.spinUrl, /event=/)
  assert.match(created.body.spinUrl, /[?&]code=/)
  assert.match(created.body.event.mode, /after_event/)

  const dayEntry = await json(await app.request('/api/entries', {
    method: 'POST',
    body: entryForm({ homeowner_phone: '81230001', homeowner_email: 'day@example.com', mount: 'events' })
  }))
  assert.equal(dayEntry.status, 200, dayEntry.body.error)
  assert.equal(dayEntry.body.mode, 'event_day')
  assert.match(dayEntry.body.spinUrl, /\/events\/spin\?/)
  assert.doesNotMatch(dayEntry.body.spinUrl, /code=/)

  const configured = getConfig().events.find((event) => event.slug === 'reno-fiesta-nov-2026-after')
  assert.equal(configured.mode, 'after_event')
})

test('staff can verify but cannot export, void, change settings, or open proof files', async () => {
  const { app } = await build()
  const adminLogin = await app.request('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@renofiesta.sg', password: 'test-password-1' })
  })
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0]
  const createdUser = await json(await app.request('/api/admin/users', {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Asha', email: 'asha@example.com', role: 'staff', password: 'staff-pass-1' })
  }))
  assert.equal(createdUser.status, 200, createdUser.body.error)
  const staffLogin = await app.request('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'asha@example.com', password: 'staff-pass-1' })
  })
  const staffCookie = staffLogin.headers.get('set-cookie').split(';')[0]
  const created = await json(await app.request('/api/entries', { method: 'POST', body: entryForm({ homeowner_phone: '81238888', homeowner_email: 'role@example.com' }) }))
  const list = await json(await app.request('/api/admin/entries', { headers: { cookie: staffCookie } }))
  assert.equal(list.status, 200)
  assert.equal(list.body.entries[0].proof_link, '')
  const csv = await app.request('/api/admin/entries.csv', { headers: { cookie: staffCookie } })
  assert.equal(csv.status, 403)
  const settings = await app.request('/api/admin/kiosk-qr', {
    method: 'PUT',
    headers: { cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ size: 20, unit: 'percent', position: 'top-center' })
  })
  assert.equal(settings.status, 403)
  const users = await app.request('/api/admin/users', { headers: { cookie: staffCookie } })
  assert.equal(users.status, 403)
  const liveDenied = await app.request('/api/admin/live', {
    method: 'POST',
    headers: { cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'reno-fiesta-nov-2026' })
  })
  assert.equal(liveDenied.status, 403)
  const odds = await app.request('/api/admin/odds', { headers: { cookie: staffCookie } })
  assert.equal(odds.status, 403)
  const outbox = await app.request('/api/admin/outbox', { headers: { cookie: staffCookie } })
  assert.equal(outbox.status, 403)
  const entry = list.body.entries.find((row) => row.code === created.body.code)
  const verified = await json(await app.request(`/api/admin/entries/${entry.id}`, {
    method: 'POST',
    headers: { cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'verify' })
  }))
  assert.equal(verified.status, 200)
  assert.equal(verified.body.entry.verified_by, 'asha@example.com')
  const deniedVoid = await json(await app.request(`/api/admin/entries/${entry.id}`, {
    method: 'POST',
    headers: { cookie: staffCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'void' })
  }))
  assert.equal(deniedVoid.status, 403)
  const proof = await app.request(new URL(created.body ? '/proof/x/y' : '/proof/x/y', 'http://localhost').pathname, { headers: { cookie: staffCookie } })
  assert.equal(proof.status, 404)
  const adminList = await json(await app.request('/api/admin/entries', { headers: { cookie: adminCookie } }))
  const withFile = adminList.body.entries.find((row) => row.code === created.body.code)
  assert.ok(withFile.proof_link.includes('/proof/'))
  const blockedFile = await app.request(new URL(withFile.proof_link).pathname, { headers: { cookie: staffCookie } })
  assert.equal(blockedFile.status, 403)
  const removed = await json(await app.request(`/api/admin/users/${(await storeAdmins(app, adminCookie))[0].id}`, {
    method: 'POST',
    headers: { cookie: adminCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete' })
  }))
  assert.equal(removed.status, 409)
})

async function storeAdmins(app, cookie) {
  const body = await json(await app.request('/api/admin/users', { headers: { cookie } }))
  return body.body.users.filter((user) => user.role === 'admin')
}

test('the prize pop-up stays for two minutes and counts down as m:ss', async () => {
  const config = getConfig()
  assert.equal(config.kioskResetSeconds, 120)
  assert.equal(config.idleResetSeconds, 90)
  assert.ok(config.kioskResetSeconds > config.idleResetSeconds)

  const { app } = await build()
  const boot = await json(await app.request('/api/bootstrap'))
  assert.equal(boot.body.kioskResetSeconds, 120)
  assert.equal(boot.body.idleResetSeconds, 90)

  const source = fs.readFileSync(new URL('../public/js/kiosk.js', import.meta.url), 'utf8')
  assert.match(source, /if \(mode === 'spinning' \|\| mode === 'result'\) return/)
  assert.match(source, /startCountdown\(boot\.kioskResetSeconds \|\| 120, 'Closing in', \$\('count'\), true\)/)
  assert.match(source, /id="codeInput"/)
  assert.doesNotMatch(source, /data-key/)
  const fn = source.match(/function closingClock\(seconds\) \{[\s\S]*?\n  \}/)
  assert.ok(fn)
  const closingClock = vm.runInNewContext(`${fn[0]}\nclosingClock`)
  assert.equal(`Closing in ${closingClock(120)}`, 'Closing in 2:00')
  assert.equal(`Closing in ${closingClock(119)}`, 'Closing in 1:59')
  assert.equal(`Closing in ${closingClock(5)}`, 'Closing in 0:05')
  assert.equal(`Closing in ${closingClock(0)}`, 'Closing in 0:00')
})

test('admin stays on /admin, and a created event can be set live', async () => {
  const { app } = await build()
  const adminPage = await app.request('/admin')
  assert.equal(adminPage.status, 200)
  const login = await app.request('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@renofiesta.sg', password: 'test-password-1' })
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const created = await json(await app.request('/api/admin/events', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Harbour Fest', date: '2026-12-01' })
  }))
  assert.equal(created.status, 200, created.body.error)
  assert.equal(created.body.event.slug, 'harbour-fest')
  assert.equal(created.body.event.starts, '2026-12-01')
  assert.equal(created.body.event.ends, '2026-12-01')
  assert.match(created.body.formUrl, /\/events\/e\/harbour-fest$/)
  assert.match(created.body.spinUrl, /\/events\/spin\?event=harbour-fest$/)
  assert.match(created.body.virtualFormUrl, /\/virtual$/)
  assert.match(created.body.virtualSpinUrl, /\/virtual\/spin$/)
  const boot = await json(await app.request('/api/bootstrap'))
  assert.ok(boot.body.events.some((event) => event.slug === 'harbour-fest'))
  const madeLive = await json(await app.request('/api/admin/live', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'harbour-fest' })
  }))
  assert.equal(madeLive.status, 200)
  const home = await app.request('/', { redirect: 'manual' })
  assert.equal(home.status, 302)
  assert.equal(home.headers.get('location'), '/events')
  const onSitePage = await app.request('/events')
  assert.equal(onSitePage.status, 200)
  assert.match(await onSitePage.text(), /id="eventSlot"/)
  const virtual = await app.request('/virtual')
  assert.equal(virtual.status, 200)
  const previousBase = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = 'https://luckydraw-renofiesta.onrender.com'
  const labelled = await json(await app.request('/api/admin/entries', { headers: { cookie } }))
  if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = previousBase
  assert.equal(labelled.body.hosts.event_day, 'https://luckydraw-renofiesta.onrender.com/events')
  assert.equal(labelled.body.hosts.after_event, 'https://luckydraw-renofiesta.onrender.com/virtual')
  const screen = await json(await app.request('/api/kiosk/display'))
  assert.equal(screen.body.event.slug, 'harbour-fest')
  const html = await app.request('/admin')
  const page = await html.text()
  const adminJs = fs.readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8')
  assert.match(page, /Event QR codes/)
  assert.match(adminJs, /LIVE NOW/)
  assert.match(adminJs, /On-site/)
  assert.match(adminJs, /After-event link/)
  assert.match(adminJs, /Show all events/)
  assert.match(adminJs, /otherEventPick/)
  assert.match(adminJs, /mount=events/)
  assert.doesNotMatch(adminJs, /delivery_address|Prize delivery address/)
  assert.match(page, /Start date/)
  assert.match(page, /End date/)
  assert.match(adminJs, /newEventEnd/)
  assert.match(page, /Duplicate pair/)
  const onSiteQr = await app.request('/api/admin/qr/harbour-fest?mount=events', { headers: { cookie } })
  assert.equal(onSiteQr.status, 200)
  assert.equal(onSiteQr.headers.get('content-type'), 'image/png')
  assert.match(page, /Create Event/)
  assert.match(page, /Add New Staff Account/)
  assert.match(page, /data-testid="show-all"/)
  assert.match(page, /id="stats"/)

  const ranged = await json(await app.request('/api/admin/events', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Range Fest', starts: '2026-11-27', ends: '2026-11-28' })
  }))
  assert.equal(ranged.status, 200, ranged.body.error)
  assert.equal(ranged.body.event.starts, '2026-11-27')
  assert.equal(ranged.body.event.ends, '2026-11-28')
  assert.equal(ranged.body.event.rangeLabel, '27-28 Nov 2026')
  const backwards = await json(await app.request('/api/admin/events', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Backwards Fest', starts: '2026-11-28', ends: '2026-11-27' })
  }))
  assert.equal(backwards.status, 400)
  assert.match(backwards.body.error, /end date/i)
})

test('one homeowner can submit with each designer, and the same pair is blocked on both paths', async () => {
  const { app, store } = await build()
  async function submit(fields) {
    return json(await app.request('/api/entries', { method: 'POST', body: entryForm(fields) }))
  }
  for (const mount of ['events', 'virtual']) {
    const home = mount === 'events' ? '81110001' : '81110002'
    const designerA = mount === 'events' ? '62220001' : '62220002'
    const designerB = mount === 'events' ? '63330001' : '63330002'
    const first = await submit({
      mount,
      homeowner_phone: home,
      designer_phone: designerA,
      homeowner_email: `${mount}-a@example.com`,
      designer_email: `${mount}-designer-a@example.com`
    })
    assert.equal(first.status, 200, first.body.error)
    assert.equal(first.body.code.length, 8)
    const again = await submit({
      mount,
      homeowner_phone: `+65 ${home.slice(0, 4)} ${home.slice(4)}`,
      designer_phone: `65${designerA}`,
      homeowner_email: `${mount}-a2@example.com`,
      designer_email: `${mount}-designer-a2@example.com`
    })
    assert.equal(again.status, 409)
    assert.match(again.body.error, /already spun with this designer/i)
    assert.equal(again.body.code, undefined)
    const other = await submit({
      mount,
      homeowner_phone: home,
      designer_phone: designerB,
      homeowner_email: `${mount}-b@example.com`,
      designer_email: `${mount}-designer-b@example.com`
    })
    assert.equal(other.status, 200, other.body.error)
    assert.equal(other.body.code.length, 8)
    assert.notEqual(other.body.code, first.body.code)
  }

  const login = await app.request('/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@renofiesta.sg', password: 'test-password-1' })
  })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const listed = await json(await app.request('/api/admin/entries', { headers: { cookie } }))
  const blocked = listed.body.entries.filter((row) => row.status === 'duplicate')
  assert.equal(blocked.length, 2)
  assert.ok(blocked.every((row) => row.code === ''))

  const kept = (await store.list()).find((row) => row.homeowner_phone === '81110001' && row.designer_phone === '62220001' && row.status !== 'duplicate')
  const voided = await json(await app.request(`/api/admin/entries/${kept.id}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'void' })
  }))
  assert.equal(voided.status, 200, voided.body.error)
  const afterVoid = await submit({
    mount: 'events',
    homeowner_phone: '81110001',
    designer_phone: '62220001',
    homeowner_email: 'events-again@example.com',
    designer_email: 'events-designer-again@example.com'
  })
  assert.equal(afterVoid.status, 200, afterVoid.body.error)

  const second = await json(await app.request('/api/admin/events', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Other Fest', date: todaySGT() })
  }))
  assert.equal(second.status, 200, second.body.error)
  const across = await submit({
    event_slug: second.body.event.slug,
    event_date: todaySGT(),
    mount: 'virtual',
    homeowner_phone: '81110002',
    designer_phone: '62220002',
    homeowner_email: 'across@example.com',
    designer_email: 'across-designer@example.com'
  })
  assert.equal(across.status, 409)
  assert.match(across.body.error, /already spun with this designer/i)

  const legacyHeader = ['slug', 'name', 'date', 'edition', 'active', 'created_at', 'created_by']
  assert.deepEqual(eventSheetColumns(legacyHeader), [...legacyHeader, 'starts', 'ends'])
  const legacyRow = ['old-fest', 'Old Fest', '2026-11-27', '', 'yes', '', '']
  assert.equal(eventNeedsDateBackfill(legacyHeader, legacyRow), true)
  const legacy = eventFromCells(legacyHeader, legacyRow)
  assert.equal(legacy.starts, '2026-11-27')
  assert.equal(legacy.ends, '2026-11-27')
  assert.equal(formatEventRange('2026-11-27', '2026-11-27'), '27 Nov 2026')
  assert.equal(formatEventRange('2026-11-27', '2026-11-28'), '27-28 Nov 2026')
})
