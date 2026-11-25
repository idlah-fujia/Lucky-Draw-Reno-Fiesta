import test from 'node:test'
import assert from 'node:assert/strict'
import { COLUMNS } from '../src/schema.js'
import { columnLetter, headerRange, reconcileHeader } from '../src/sheetHeader.js'
import { claimConflicts } from '../src/claims.js'
import { dashboardCounts } from '../src/entries.js'

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
