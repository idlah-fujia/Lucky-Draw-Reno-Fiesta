import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { HttpError } from './http.js'

const scrypt = promisify(scryptCb)

export const BOOTSTRAP_EMAIL = 'admin@renofiesta.sg'

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(String(password), salt, 32)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password, stored) {
  const [kind, saltB64, hashB64] = String(stored || '').split('$')
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false
  let salt
  let expected
  try {
    salt = Buffer.from(saltB64, 'base64url')
    expected = Buffer.from(hashB64, 'base64url')
  } catch {
    return false
  }
  const hash = await scrypt(String(password), salt, expected.length)
  if (hash.length !== expected.length) return false
  return timingSafeEqual(hash, expected)
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    created_at: user.created_at || '',
    updated_at: user.updated_at || ''
  }
}

export function adminCount(users) {
  return users.filter((user) => user.role === 'admin').length
}

export async function ensureBootstrapAdmin(store, { email, password, name = 'Admin' }) {
  const normalized = normalizeEmail(email || BOOTSTRAP_EMAIL)
  if (!password || String(password).length < 8) {
    throw new Error('Set ADMIN_PASSWORD in .env to at least 8 characters before starting.')
  }
  await store.updateUsers(async (users) => {
    if (users.some((user) => user.role === 'admin')) return
    const now = new Date().toISOString()
    users.push({
      id: randomUUID(),
      name,
      email: normalized,
      role: 'admin',
      password_hash: await hashPassword(password),
      created_at: now,
      updated_at: now
    })
  })
}

export function assertUserChange(users, target, action, nextRole) {
  const admins = adminCount(users)
  const isLastAdmin = target.role === 'admin' && admins <= 1
  if (action === 'delete' && isLastAdmin) {
    throw new HttpError(409, 'The last admin account can’t be removed.')
  }
  if (action === 'role' && isLastAdmin && nextRole !== 'admin') {
    throw new HttpError(409, 'The last admin account can’t be changed to staff.')
  }
}
