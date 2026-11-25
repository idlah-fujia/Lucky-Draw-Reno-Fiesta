import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { LocalStore } from '../src/storage/local.js'
import { LocalFiles } from '../src/files.js'
import { todaySGT } from '../src/http.js'
import { formatCode } from '../src/codes.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function testConfig() {
  return {
    whatsapp: '6588949268',
    kioskResetSeconds: 25,
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

async function build() {
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
    allowForcePrize: true
  })
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
    delivery_address: '10 Example Road #04-02 Singapore 123456',
    decl_contract: 'yes',
    decl_genuine: 'yes',
    decl_verify: 'yes',
    tnc: 'yes',
    ...overrides
  }
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  const file = overrides.proof === null ? null : new File([png], 'receipt.png', { type: 'image/png' })
  if (file) data.set('proof', file)
  return data
}

async function json(res) {
  const body = await res.json()
  return { status: res.status, body }
}

test('submit, designer, one spin, then the same code shows the prize', async () => {
  const { app, sent } = await build()
  const created = await json(await app.request('/api/entries', { method: 'POST', body: entryForm() }))
  assert.equal(created.status, 200)
  assert.equal(created.body.code.length, 8)
  assert.equal(created.body.email, 'mei@example.com')
  assert.equal(created.body.emailStatus, 'logged')
  assert.equal(sent.records.length, 1)
  assert.match(sent.records[0].text, /big screen/)
  assert.match(sent.records[0].text, new RegExp(formatCode(created.body.code)))
  assert.doesNotMatch(sent.records[0].text, /undefined/)

  const dup = await json(await app.request('/api/entries', { method: 'POST', body: entryForm() }))
  assert.equal(dup.status, 409)

  const missingDesigner = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, event: 'reno-fiesta-nov-2026' })
  }))
  assert.equal(missingDesigner.status, 400)

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
  assert.equal(lookup.body.state, 'needs_designer')
  assert.equal(lookup.body.canContinue, true)
  assert.equal(lookup.body.firstName, 'Mei')
  assert.equal(lookup.body.homeowner_phone, undefined)

  const saved = await json(await app.request('/api/spin/designer', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: created.body.code,
      event: 'reno-fiesta-nov-2026',
      designer_name: 'Alicia Ong',
      designer_phone: '62345678',
      designer_email: 'alicia@studio.example',
      id_company: 'Studio Example'
    })
  }))
  assert.equal(saved.body.state, 'ready')
  assert.equal(saved.body.canContinue, true)

  const spun = await json(await app.request('/api/spin/go', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: created.body.code, event: 'reno-fiesta-nov-2026', forcePrize: 'GRAB40' })
  }))
  assert.equal(spun.status, 200)
  assert.equal(spun.body.result.prizeId, 'GRAB40')
  assert.equal(spun.body.result.slot >= 0, true)
  assert.equal(spun.body.already, false)
  assert.equal(sent.records.length, 3)

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
  assert.equal(sent.records.length, 3)
})

test('iphone can be won once, a void frees it, and admin can export', async () => {
  const { app } = await build()
  async function signup(phone, name) {
    const created = await json(await app.request('/api/entries', {
      method: 'POST',
      body: entryForm({ homeowner_phone: phone, homeowner_name: name, homeowner_email: `${phone}@example.com` })
    }))
    assert.equal(created.status, 200, created.body.error)
    await json(await app.request('/api/spin/designer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: created.body.code, event: 'reno-fiesta-nov-2026', designer_name: 'Alicia Ong', designer_phone: '62345678',
        designer_email: 'alicia@studio.example', id_company: 'Studio Example'
      })
    }))
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
    body: JSON.stringify({ password: 'test-password-1' })
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
  text.set('delivery_address', '10 Example Road Singapore')
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
    const saved = await json(await app.request('/api/spin/designer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: created.body.code, event: 'reno-fiesta-nov-2026', designer_name: 'Alicia Ong',
        designer_phone: '62345678', designer_email: 'alicia@studio.example', id_company: 'Studio Example'
      })
    }))
    assert.equal(saved.body.canContinue, true)
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
