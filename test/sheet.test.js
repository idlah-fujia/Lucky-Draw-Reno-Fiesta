import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { COLUMNS } from '../src/schema.js'
import { columnLetter, headerRange, reconcileHeader } from '../src/sheetHeader.js'
import { claimConflicts } from '../src/claims.js'
import { dashboardCounts } from '../src/entries.js'
import { versionLabel } from '../src/hosts.js'
import { HttpError } from '../src/http.js'
import { SheetsStore, isSheetQuota } from '../src/storage/sheets.js'

test('the Entries header is read past column AJ and older headers grow at the end', () => {
  assert.equal(columnLetter(36), 'AJ')
  assert.equal(columnLetter(COLUMNS.length) > 'AJ', true)
  assert.match(headerRange(COLUMNS.length), /AZ$/)
  const old = COLUMNS.slice(0, 36)
  const decision = reconcileHeader(old, COLUMNS)
  assert.equal(decision.action, 'extend')
  assert.deepEqual(decision.missing.at(-3), 'site_mode')
  assert.ok(decision.missing.includes('spam_at'))
  assert.ok(decision.missing.includes('spam_by'))
  assert.equal(reconcileHeader(COLUMNS, COLUMNS).action, 'ok')
  assert.equal(reconcileHeader([], COLUMNS).action, 'write')
})

test('dashboard counts follow the entry definitions', () => {
  const counts = dashboardCounts([
    { code: 'AAAAAAAA', status: 'submitted', prize_id: '', verified_at: '', voided_at: '', spam_at: '' },
    { code: 'BBBBBBBB', status: 'verified', prize_id: 'IPHONE', verified_at: '2026-01-01', voided_at: '', spam_at: '' },
    { code: 'CCCCCCCC', status: 'spam', prize_id: '', verified_at: '', voided_at: '', spam_at: '2026-01-02' },
    { code: 'DDDDDDDD', status: 'voided', prize_id: 'IPHONE', verified_at: '2026-01-01', voided_at: '2026-01-03', spam_at: '' }
  ])
  assert.equal(counts.total, 4)
  assert.equal(counts.submitted, 2)
  assert.equal(counts.spam, 1)
  assert.equal(counts.verified, 2)
  assert.equal(counts.voided, 1)
  assert.equal(counts.iphone, 1)
})

test('a fresh sheet read blocks a duplicate code and a second iPhone', () => {
  const before = []
  const proposed = [{ id: 'new', code: 'ABCDEFGH', event_slug: 'reno', prize_id: 'IPHONE', status: 'spun' }]
  assert.equal(claimConflicts(before, proposed, [
    { id: 'other', code: 'ABCDEFGH', event_slug: 'reno', prize_id: '', status: 'submitted' }
  ], { oncePerEventIds: ['IPHONE'] }), 'code')
  assert.equal(claimConflicts(before, proposed, [
    { id: 'other', code: 'ZZZZZZZ2', event_slug: 'reno', prize_id: 'IPHONE', status: 'spun' }
  ], { oncePerEventIds: ['IPHONE'] }), 'prize')
  assert.equal(claimConflicts(before, proposed, [
    { id: 'other', code: 'ZZZZZZZ2', event_slug: 'reno', prize_id: 'IPHONE', status: 'voided' }
  ], { oncePerEventIds: ['IPHONE'] }), null)
})

test('version labels keep the /events and /virtual path', () => {
  const base = 'https://luckydraw-renofiesta.onrender.com'
  assert.equal(versionLabel('event_day', base), 'luckydraw-renofiesta.onrender.com/events')
  assert.equal(versionLabel('after_event', base), 'luckydraw-renofiesta.onrender.com/virtual')
  const admin = fs.readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8')
  assert.match(admin, /url\.host \+ path/)
  assert.doesNotMatch(admin, /return new URL\(base\)\.host;/)
})

test('user reads prepare the users tab once and then stay in memory', async () => {
  const store = new SheetsStore()
  store.spreadsheetId = 'sheet'
  let meta = 0
  let values = 0
  store.accessToken = async () => 'token'
  store.sheets = async (url) => {
    if (String(url).includes('fields=sheets.properties.title')) {
      meta += 1
      return { sheets: [{ properties: { title: 'users' } }] }
    }
    values += 1
    return { values: [['id', 'name', 'email', 'role', 'password_hash', 'created_at', 'updated_at'], ['1', 'Ada', 'ada@example.com', 'admin', 'hash', '', '']] }
  }
  const first = await store.readUsers()
  const second = await store.readUsers()
  assert.equal(first[0].email, 'ada@example.com')
  assert.equal(second[0].name, 'Ada')
  assert.equal(meta, 1)
  assert.equal(values, 1)
  store.memo.get('users').at = 0
  await store.readUsers()
  assert.equal(meta, 1)
  assert.equal(values, 2)
})

test('a sheet 429 is retried and a sign-in limit is not treated as quota', async () => {
  const store = new SheetsStore()
  let tries = 0
  store.sheetsOnce = async () => {
    tries += 1
    if (tries === 1) {
      const error = new Error('Google Sheets error 429: Quota exceeded')
      error.status = 429
      throw error
    }
    return { ok: true }
  }
  const result = await store.sheets('https://sheets.example/values')
  assert.equal(result.ok, true)
  assert.equal(tries, 2)
  assert.equal(isSheetQuota(new HttpError(429, 'Too many tries. Wait a few minutes.')), false)
})
