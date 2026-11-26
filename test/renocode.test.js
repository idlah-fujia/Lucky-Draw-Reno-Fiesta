import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  NOT_ATTENDED_MESSAGE,
  NO_CHECKIN_MESSAGE,
  UNAVAILABLE_MESSAGE,
  attendanceDecision,
  checkAfterEventAttendance,
  clearRenocodeCache,
  loadAttendees,
  phoneKey,
  renocodeStatus
} from '../src/renocode.js'

const secret = 'super-secret-renocode-key'
const env = { RENOCODE_SUPABASE_URL: 'https://renocode.example', RENOCODE_SUPABASE_KEY: secret }

function jsonResponse(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[String(name).toLowerCase()] || '' },
    json: async () => body
  }
}

test('attendance matches the last 8 digits and the scammer flags', () => {
  assert.equal(phoneKey('+65 9123-4567'), '91234567')
  assert.equal(phoneKey('6591234567'), '91234567')
  assert.equal(phoneKey('123'), '')
  const rows = [
    { phone: '+65 9123 4567', arrived: true, scammer: false, pre_scammer: false },
    { phone: '81234567', arrived: false, scammer: false, pre_scammer: false },
    { phone: '93334444', arrived: true, scammer: false, pre_scammer: 'true' }
  ]
  assert.equal(attendanceDecision(rows, '91234567').ok, true)
  assert.equal(attendanceDecision(rows, '6591234567').ok, true)
  assert.equal(attendanceDecision(rows, '81234567').reason, 'not_attended')
  assert.equal(attendanceDecision(rows, '93334444').reason, 'not_attended')
  assert.equal(attendanceDecision([{ phone: '91234567', arrived: false }], '91234567').reason, 'no_checkin')
  assert.equal(attendanceDecision([], '91234567').reason, 'no_checkin')
})

test('the Supabase client only GETs, paginates, caches, and never returns the key', async () => {
  clearRenocodeCache()
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ method: options.method, url, headers: options.headers, body: options.body })
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.apikey, secret)
    assert.equal(options.headers.authorization, `Bearer ${secret}`)
    if (String(url).includes('/events?')) return jsonResponse([{ id: 'evt-1', code: 'RF33' }])
    if (String(options.headers.range || '').startsWith('0-')) {
      const rows = Array.from({ length: 1000 }, (_, index) => ({ phone: `9000${String(index).padStart(4, '0')}`, arrived: index === 0, scammer: false, pre_scammer: false }))
      return jsonResponse(rows, { 'content-range': '0-999/1001' })
    }
    return jsonResponse([{ phone: '91234567', arrived: true, scammer: false, pre_scammer: false }], { 'content-range': '1000-1000/1001' })
  }
  const now = 1_700_000_000_000
  const first = await loadAttendees('rf33', env, { fetchImpl, now: () => now })
  assert.equal(first.length, 1001)
  assert.equal(attendanceDecision(first, '91234567').ok, true)
  const cached = await loadAttendees('RF33', env, { fetchImpl, now: () => now + 30_000 })
  assert.equal(cached, first)
  assert.equal(calls.length, 3)
  await loadAttendees('RF33', env, { fetchImpl, now: () => now + 61_000 })
  assert.equal(calls.length, 6)
  assert.equal(calls.every((call) => call.method === 'GET' && call.body == null), true)
  const source = fs.readFileSync(new URL('../src/renocode.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /method:\s*'(POST|PUT|PATCH|DELETE)'/)
  assert.doesNotMatch(source, /AbortSignal\.timeout/)

  const failing = async () => jsonResponse([], {})
  const denied = async () => ({ ok: false, status: 401, headers: { get: () => '' }, json: async () => ({ message: secret }) })
  await assert.rejects(
    () => loadAttendees('MISSING', env, { fetchImpl: async (url) => (String(url).includes('/events?') ? failing() : denied()), now: () => now + 120_000 }),
    (error) => error.code === 'renocode_event_missing' && !String(error.message).includes(secret)
  )
  await assert.rejects(
    () => loadAttendees('RF34', env, { fetchImpl: denied, now: () => now + 180_000 }),
    (error) => error.code === 'renocode_http' && !String(error.message).includes(secret)
  )
})

test('a missing key or a timeout fails closed, and on-site skips the check', async () => {
  clearRenocodeCache()
  const event = { renocode_code: 'RF33' }
  assert.deepEqual(await checkAfterEventAttendance(event, '91234567', false, {}), { action: 'allow' })
  assert.deepEqual(await checkAfterEventAttendance({ renocode_code: '' }, '91234567', true, {}), { action: 'allow' })
  assert.equal(renocodeStatus({}), 'missing')
  assert.deepEqual(await checkAfterEventAttendance(event, '91234567', true, { RENOCODE_SUPABASE_URL: 'https://renocode.example' }), { action: 'unavailable' })
  const hung = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    })
  })
  const result = await checkAfterEventAttendance(event, '91234567', true, env, { fetchImpl: hung, timeoutMs: 20 })
  assert.deepEqual(result, { action: 'unavailable' })
  const arrived = async (url) => {
    if (String(url).includes('/events?')) return jsonResponse([{ id: 'evt-1', code: 'RF33' }])
    return jsonResponse([{ phone: '91234567', arrived: true, scammer: false, pre_scammer: false }])
  }
  clearRenocodeCache()
  const ok = await checkAfterEventAttendance(event, '91234567', true, env, { fetchImpl: arrived, now: () => 5_000 })
  assert.deepEqual(ok, { action: 'allow' })
  assert.equal(NOT_ATTENDED_MESSAGE.includes('attendance'), true)
  assert.equal(NO_CHECKIN_MESSAGE.includes('check-in'), true)
  assert.equal(UNAVAILABLE_MESSAGE.includes('try again later'), true)
})
