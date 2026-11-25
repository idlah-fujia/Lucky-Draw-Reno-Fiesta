import test from 'node:test'
import assert from 'node:assert/strict'
import { pickPrize, oddsTable, soldOutIds } from '../src/prizes.js'
import { parseCode, generateCode, ALPHABET } from '../src/codes.js'
import { toCsv } from '../src/schema.js'

const config = {
  prizes: [
    { id: 'GRAB40', brand: 'Grab', label: '$40 Grab voucher', weight: 10 },
    { id: 'IPHONE', brand: 'Apple', label: 'iPhone Duo or iPhone 18 Pro Max', weight: 1, oncePerEvent: true }
  ],
  slots: ['GRAB40', 'IPHONE', 'GRAB40', 'GRAB40']
}

test('codes are 8 unambiguous characters', () => {
  for (let i = 0; i < 30; i += 1) {
    const code = generateCode()
    assert.equal(code.length, 8)
    for (const ch of code) assert.ok(ALPHABET.includes(ch))
    assert.equal(parseCode(code).code, code)
    assert.equal(parseCode(`${code.slice(0, 4)}-${code.slice(4)}`).code, code)
  }
  assert.match(parseCode('OOOOOOOO').error, /isn’t used/)
  assert.match(parseCode('ABC').error, /8/)
})

test('iphone slice is excluded once it is sold out', () => {
  const first = pickPrize(config, [], () => 0.34)
  assert.equal(first.id, 'IPHONE')
  for (let i = 0; i < 20; i += 1) {
    assert.notEqual(pickPrize(config, ['IPHONE'], Math.random).id, 'IPHONE')
  }
  const odds = oddsTable(config, ['IPHONE'])
  assert.equal(odds.find((row) => row.id === 'IPHONE').available, false)
  assert.equal(odds.find((row) => row.id === 'GRAB40').percent, '100.00')
})

test('a voided iphone does not count as sold out', () => {
  const list = [
    { event_slug: 'reno', prize_id: 'IPHONE', status: 'voided' },
    { event_slug: 'other', prize_id: 'IPHONE', status: 'spun' }
  ]
  assert.deepEqual(soldOutIds(list, 'reno', config), [])
  list.push({ event_slug: 'reno', prize_id: 'IPHONE', status: 'verified' })
  assert.deepEqual(soldOutIds(list, 'reno', config), ['IPHONE'])
})

test('csv neutralises spreadsheet formulas', () => {
  const csv = toCsv([{ homeowner_name: '=cmd()', code: 'ABCD2345' }])
  assert.match(csv, /'=cmd\(\)/)
  assert.match(csv, /ABCD2345/)
})
