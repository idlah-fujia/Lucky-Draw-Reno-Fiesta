import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMailer } from '../src/email.js'

test('parallel outbox writes keep every message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'))
  const mailer = createMailer(dir)
  const total = 8
  await Promise.all(Array.from({ length: total }, (_, index) => mailer.send({
    to: `person${index}@example.com`,
    subject: 'Prize',
    text: `message ${index}`
  })))
  const recent = await mailer.recent(20)
  assert.equal(recent.length, total)
  const recipients = new Set(recent.map((row) => row.to))
  assert.equal(recipients.size, total)
})
