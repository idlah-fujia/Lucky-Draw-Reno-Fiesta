import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cookies } from './http.js'

const COOKIE = 'sws_session'
const MAX_AGE = 60 * 60 * 14

export function loadFileSecret(dataDir) {
  if (process.env.FILE_LINK_SECRET) return process.env.FILE_LINK_SECRET
  const file = path.join(dataDir, 'file-secret.txt')
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(file, randomBytes(32).toString('hex'))
  }
  return fs.readFileSync(file, 'utf8').trim()
}

export function adminPassword() {
  const password = process.env.ADMIN_PASSWORD
  if (!password || password.length < 8) {
    throw new Error('Set ADMIN_PASSWORD in .env to at least 8 characters before starting.')
  }
  return password
}

function sign(payload, password) {
  return createHmac('sha256', password).update(payload).digest('base64url')
}

export function adminCookie(password, now = Date.now()) {
  const exp = now + MAX_AGE * 1000
  const payload = String(exp)
  return `${payload}.${sign(payload, password)}`
}

export function adminCookieHeader(token, { secure = false, clear = false } = {}) {
  const bits = [
    `${COOKIE}=${clear ? '' : token}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${clear ? 0 : MAX_AGE}`,
    'SameSite=Lax'
  ]
  if (secure) bits.push('Secure')
  return bits.join('; ')
}

export function readAdmin(c, password) {
  const token = cookies(c)[COOKIE]
  if (!token) return false
  const [payload, mac] = token.split('.')
  if (!payload || !mac) return false
  const exp = Number(payload)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const expected = Buffer.from(sign(payload, password))
  const given = Buffer.from(mac)
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

export function sessionToken(userId, secret, now = Date.now()) {
  const exp = now + MAX_AGE * 1000
  const payload = `${userId}.${exp}`
  return `${payload}.${sign(payload, secret)}`
}

export function readSession(c, secret) {
  const token = cookies(c)[COOKIE]
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, expRaw, mac] = parts
  const exp = Number(expRaw)
  if (!userId || !Number.isFinite(exp) || exp < Date.now()) return null
  const payload = `${userId}.${expRaw}`
  const expected = Buffer.from(sign(payload, secret))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return { userId }
}

export function passwordsMatch(given, expected) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
