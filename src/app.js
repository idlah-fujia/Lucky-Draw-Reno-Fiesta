import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { getConnInfo } from '@hono/node-server/conninfo'
import QRCode from 'qrcode'
import { HttpError, rateLimit, requestBaseUrl, todaySGT } from './http.js'
import { findEvent, getConfig, publicEvent } from './config.js'
import { defaultEvent, eventMode, modeFromMount, modeFromPath, prefixFor, siteMode } from './mode.js'
import { assertEventDate, mergeEvents, slugifyEventName, uniqueSlug } from './events.js'
import { formatCode, generateCode, parseCode } from './codes.js'
import { proofPath, validProofSig } from './sign.js'
import { oddsTable, pickPrize, prizeMap, soldOutIds } from './prizes.js'
import { attachSoldOut, createEntry, firstName, kioskView, reviewEntry, saveDesigner, spinEntry, verifySpinCode } from './entries.js'
import { MAX_PROOF_BYTES, cleanText, emailAddress, eventDate, homeownerPhone, designerPhone, isUuid, requireYes, safeFilename, sniffProof } from './validate.js'
import { codeEmail, resultEmails } from './email.js'
import { adminCookieHeader, readSession, sessionToken } from './auth.js'
import { assertUserChange, hashPassword, normalizeEmail, publicUser, verifyPassword } from './users.js'
import { toCsv, versionLabel } from './schema.js'
import { versionRoots } from './hosts.js'
import { isSheetQuota } from './storage/sheets.js'
import { GLOBAL_EVENT, QR_LIMITS, clampSize, envKioskQr, normalizeSaved, parsePosition, resolveKioskQr } from './kioskQr.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(root, 'public')
const CREATE_EVENT_LABEL = 'Create Event'

function readPage(name) {
  return fs.readFileSync(path.join(publicDir, name), 'utf8')
}

export function createApp(deps) {
  const { store, files, mailer, adminPassword, fileSecret, allowForcePrize = false } = deps
  const configOf = deps.getConfig || getConfig
  const fallbackMode = () => deps.siteMode || siteMode()
  const asPublic = (event, fallback) => publicEvent(event, fallback || fallbackMode())
  function hintedMode(c, hint) {
    return modeFromPath(c.req.path) || modeFromMount(hint) || modeFromMount(c.req.query('mount')) || fallbackMode()
  }
  function linkFor(c, mode, slug, kind, code) {
    const root = `${requestBaseUrl(c)}${prefixFor(mode)}`
    if (kind === 'form') return `${root}/e/${encodeURIComponent(slug)}`
    const spin = `${root}/spin?event=${encodeURIComponent(slug)}`
    return code ? `${spin}&code=${encodeURIComponent(code)}` : spin
  }
  function eventLinks(c, event, hint) {
    const mode = eventMode(event, hintedMode(c, hint))
    return {
      mode,
      formUrl: linkFor(c, mode, event.slug, 'form'),
      spinUrl: linkFor(c, mode, event.slug, 'spin')
    }
  }
  async function liveConfig() {
    const base = configOf()
    const merged = mergeEvents(base.events, await store.listEvents(), await store.readLiveSlug())
    return { ...base, events: merged.events, liveSlug: merged.liveSlug }
  }
  const app = new Hono()

  app.onError((err, c) => {
    if (isSheetQuota(err)) {
      return c.json({ error: 'Google Sheet is busy, try again in a few seconds.' }, 503)
    }
    if (err instanceof HttpError || err.status) {
      return c.json({ error: err.message }, err.status || 400)
    }
    console.error(err)
    const message = String(err?.message || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    return c.json({ error: message || 'Something went wrong. Please try again.' }, 500)
  })

  app.use('/api/*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/api/health', (c) => c.json({
    ok: true,
    time: new Date().toISOString(),
    storage: store.mode,
    siteMode: fallbackMode(),
    email: mailer.mode,
    files: files.mode
  }))

  app.get('/api/bootstrap', async (c) => {
    const config = await liveConfig()
    return c.json({
      today: todaySGT(),
      whatsapp: config.whatsapp,
      kioskResetSeconds: config.kioskResetSeconds || 120,
      invalidResetSeconds: config.invalidResetSeconds || 12,
      idleResetSeconds: config.idleResetSeconds || 90,
      siteMode: fallbackMode(),
      events: config.events.filter((event) => event.active).map(asPublic),
      slots: config.slots
    })
  })

  app.get('/api/kiosk/display', async (c) => {
    const config = await liveConfig()
    const event = eventForScreen(config, c.req.query('event'))
    const qr = resolveKioskQr(await store.readKioskQr(), event.slug)
    return c.json({
      event: asPublic(event),
      formUrl: eventLinks(c, event).formUrl,
      qr
    })
  })

  app.get('/api/kiosk/qr.png', async (c) => {
    const config = await liveConfig()
    const event = eventForScreen(config, c.req.query('event'))
    return qrPng(c, eventLinks(c, event).formUrl, `register-${event.slug}.png`)
  })

  app.get('/api/events/:slug', async (c) => {
    const config = await liveConfig()
    const event = findEvent(config, c.req.param('slug'))
    if (!event) throw new HttpError(404, 'That event link is not recognised.')
    const list = await store.list()
    return c.json({
      event: asPublic(event),
      soldOut: soldOutIds(list, event.slug, config)
    })
  })

  app.post('/api/entries', async (c) => {
    const length = Number(c.req.header('content-length') || 0)
    if (length > MAX_PROOF_BYTES + 1024 * 256) {
      throw new HttpError(413, 'That file is over 10 MB. Take a smaller photo or a PDF.')
    }
    const body = await c.req.parseBody()
    const config = await liveConfig()
    const event = findEvent(config, String(body.event_slug || '').trim())
    if (!event || !event.active) throw new HttpError(400, 'Choose the event you attended.')
    const now = new Date()
    const nowIso = now.toISOString()
    const phone = homeownerPhone(body.homeowner_phone)
    const designerName = cleanText(body.designer_name, { min: 2, max: 80, label: 'the designer’s name' })
    const designerPhoneValue = designerPhone(body.designer_phone)
    const designerEmail = emailAddress(body.designer_email, 'the designer’s email')
    const company = cleanText(body.id_company, { min: 2, max: 120, label: 'the interior design company' })
    if (designerPhoneValue === phone) {
      throw new HttpError(400, 'The designer’s number must be different from the homeowner’s number.')
    }
    const file = body.proof
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      throw new HttpError(400, 'Upload the down payment receipt or signed contract.')
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > MAX_PROOF_BYTES) throw new HttpError(413, 'Proof file must be under 10 MB.')
    const mime = sniffProof(buffer, file.name)
    if (!mime) throw new HttpError(400, 'Upload a photo (JPG, PNG, WEBP or HEIC) or a PDF.')
    requireYes(body.decl_contract, 'Please confirm the contract declaration.')
    requireYes(body.decl_genuine, 'Please confirm the details are true.')
    requireYes(body.decl_verify, 'Please agree that IDLah may verify this entry.')
    requireYes(body.tnc, 'Please agree to the terms and conditions.')

    const id = randomUUID()
    const filename = safeFilename(file.name)
    await files.save(id, { buffer, contentType: mime })

    let entry
    try {
      entry = await store.transaction((list) => {
        let code = ''
        for (let attempt = 0; attempt < 6; attempt += 1) {
          code = generateCode()
          if (!list.some((row) => row.code === code)) break
        }
        const base = requestBaseUrl(c)
        const row = {
          id,
          code,
          status: 'submitted',
          event_slug: event.slug,
          event_name: event.name,
          event_edition: event.edition || '',
          event_date: eventDate(body.event_date, event, now),
          homeowner_name: cleanText(body.homeowner_name, { min: 2, max: 80, label: 'the homeowner’s name' }),
          homeowner_phone: phone,
          homeowner_email: emailAddress(body.homeowner_email, 'the homeowner’s email'),
          delivery_address: cleanText(body.delivery_address, { min: 8, max: 300, label: 'the prize delivery address' }),
          designer_name: designerName,
          designer_phone: designerPhoneValue,
          designer_email: designerEmail,
          id_company: company,
          proof_key: id,
          proof_link: `${base}${proofPath(id, fileSecret)}`,
          proof_filename: filename,
          proof_mime: mime,
          proof_bytes: String(buffer.length),
          prize_id: '',
          prize_label: '',
          prize_brand: '',
          prize_slot: '',
          decl_contract: 'yes',
          decl_genuine: 'yes',
          decl_verify: 'yes',
          decl_tnc: 'yes',
          code_email_status: '',
          result_email_status: '',
          created_at: nowIso,
          designer_saved_at: nowIso,
          spun_at: '',
          verified_at: '',
          voided_at: '',
          updated_at: nowIso,
          verified_by: '',
          voided_by: '',
          site_mode: eventMode(event, hintedMode(c, body.mount)),
          spam_at: '',
          spam_by: ''
        }
        return createEntry(list, row)
      }, { oncePerEventIds: oncePerEventIds(config) })
    } catch (error) {
      await files.remove(id).catch(() => {})
      throw error
    }

    const mode = eventMode(event, hintedMode(c, body.mount))
    const spinUrl = linkFor(c, mode, event.slug, 'spin', mode === 'after_event' ? entry.code : '')
    const mailed = await mailer.send(codeEmail({ entry, spinUrl, whatsapp: config.whatsapp, mode }))
    await store.transaction((list) => {
      const row = list.find((item) => item.id === entry.id)
      if (row) {
        row.code_email_status = mailed.status
        row.updated_at = new Date().toISOString()
      }
    })

    return c.json({
      code: entry.code,
      codeDisplay: formatCode(entry.code),
      firstName: firstName(entry.homeowner_name),
      email: entry.homeowner_email,
      emailStatus: mailed.status,
      event: asPublic(event),
      mode,
      spinUrl
    })
  })

  app.post('/api/spin/lookup', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = parseCode(body.code)
    if (parsed.error) throw new HttpError(400, parsed.error)
    const config = await liveConfig()
    const view = await store.transaction((list) => verifySpinCode(list, parsed.code, body.event, config))
    return c.json(view)
  })

  app.post('/api/spin/designer', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = parseCode(body.code)
    if (parsed.error) throw new HttpError(400, parsed.error)
    const fields = {
      designer_name: cleanText(body.designer_name, { min: 2, max: 80, label: 'the designer’s name' }),
      designer_phone: designerPhone(body.designer_phone),
      designer_email: emailAddress(body.designer_email, 'the designer’s email'),
      id_company: cleanText(body.id_company, { min: 2, max: 120, label: 'the interior design company' })
    }
    const config = await liveConfig()
    const entry = await store.transaction((list) => saveDesigner(list, parsed.code, fields, new Date().toISOString(), body.event))
    const list = await store.list()
    return c.json(attachSoldOut(kioskView(entry, config), list, config))
  })

  app.post('/api/spin/go', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = parseCode(body.code)
    if (parsed.error) throw new HttpError(400, parsed.error)
    const config = await liveConfig()
    const prizes = prizeMap(config)
    let forced = null
    if (allowForcePrize && body.forcePrize && mayForcePrize(c)) {
      const prize = prizes.get(String(body.forcePrize))
      if (!prize) throw new HttpError(400, 'Unknown prize.')
      const slot = config.slots.findIndex((id) => id === prize.id)
      if (slot < 0) throw new HttpError(400, 'That prize is not on the wheel.')
      forced = { slot, id: prize.id, label: prize.label, brand: prize.brand, oncePerEvent: !!prize.oncePerEvent }
    }
    const outcome = await store.transaction((list) => {
      // The store runs this alone: it reloads the sheet or file, checks the
      // code and the iPhone, then saves. The next spin cannot start until
      // that save has finished, so two spins cannot both take the iPhone.
      const view = verifySpinCode(list, parsed.code, body.event, config)
      const existing = list.find((row) => row.code === parsed.code)
      if (!view.canContinue) {
        if (existing.status === 'voided') {
          throw new HttpError(409, 'This code has been voided. Please see the IDLah booth.')
        }
        if (existing.prize_id) return { entry: existing, already: true }
        if (view.state === 'needs_designer') {
          throw new HttpError(400, 'This code has no interior designer on it, so it can’t spin. Please see the IDLah booth.')
        }
        throw new HttpError(409, 'This code can’t be used.')
      }
      const sold = view.soldOut
      let prize = forced
      if (prize?.oncePerEvent && sold.includes(prize.id)) {
        throw new HttpError(409, 'The iPhone has been fully redeemed for this event.')
      }
      if (!prize) prize = pickPrize(config, sold)
      return spinEntry(list, parsed.code, prize, new Date().toISOString(), config, body.event)
    }, { oncePerEventIds: oncePerEventIds(config) })

    let emailStatus = outcome.entry.result_email_status || ''
    if (!outcome.already) {
      const spinUrl = linkFor(c, outcome.entry.site_mode || hintedMode(c), outcome.entry.event_slug, 'spin')
      const messages = resultEmails({ entry: outcome.entry, spinUrl, whatsapp: config.whatsapp })
      const results = []
      for (const message of messages) results.push(await mailer.send(message))
      emailStatus = results.every((item) => item.status === 'sent')
        ? 'sent'
        : results.some((item) => item.status === 'failed')
          ? 'failed'
          : 'logged'
      await store.transaction((list) => {
        const row = list.find((item) => item.id === outcome.entry.id)
        if (row) {
          row.result_email_status = emailStatus
          row.updated_at = new Date().toISOString()
        }
      })
      outcome.entry.result_email_status = emailStatus
    }

    const list = await store.list()
    const view = attachSoldOut(kioskView(outcome.entry, config), list, config)
    return c.json({ ...view, already: outcome.already, emailStatus })
  })

  app.get('/proof/:id/:sig', async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id) || !validProofSig(id, c.req.param('sig'), fileSecret)) {
      throw new HttpError(404, 'That file link does not work.')
    }
    const session = readSession(c, fileSecret)
    if (session) {
      const users = await store.readUsers()
      const user = users.find((item) => item.id === session.userId)
      if (user && user.role !== 'admin') throw new HttpError(403, 'Proof files are for admin accounts.')
    }
    return sendProof(c, store, files, id)
  })

  app.post('/api/admin/login', async (c) => {
    const ip = remoteIp(c)
    if (!rateLimit(`login:${ip}`, 8, 15 * 60 * 1000)) {
      throw new HttpError(429, 'Too many tries. Wait a few minutes.')
    }
    const body = await c.req.json().catch(() => ({}))
    const email = normalizeEmail(body.email)
    const users = await store.readUsers()
    const user = users.find((item) => item.email === email)
    const ok = user ? await verifyPassword(body.password || '', user.password_hash) : false
    if (!ok) throw new HttpError(401, 'That email or password is not right.')
    const secure = requestBaseUrl(c).startsWith('https://')
    c.header('Set-Cookie', adminCookieHeader(sessionToken(user.id, fileSecret), { secure }))
    return c.json({
      ok: true,
      ...publicUser(user),
      storage: store.mode,
      mail: mailer.mode,
      files: files.mode
    })
  })

  app.post('/api/admin/logout', (c) => {
    const secure = requestBaseUrl(c).startsWith('https://')
    c.header('Set-Cookie', adminCookieHeader('', { secure, clear: true }))
    return c.json({ ok: true })
  })

  app.use('*', async (c, next) => {
    const pathName = c.req.path
    if (pathName.startsWith('/api/admin/') && pathName !== '/api/admin/login') {
      const session = readSession(c, fileSecret)
      if (!session) throw new HttpError(401, 'Sign in again.')
      const users = await store.readUsers()
      const user = users.find((item) => item.id === session.userId)
      if (!user) throw new HttpError(401, 'Sign in again.')
      c.set('staff', user)
    }
    await next()
  })

  app.get('/api/admin/session', (c) => {
    const user = c.get('staff')
    return c.json({
      ok: true,
      ...publicUser(user),
      storage: store.mode,
      mail: mailer.mode,
      files: files.mode
    })
  })

  app.get('/api/admin/users', async (c) => {
    requireAdmin(c)
    const users = await store.readUsers()
    return c.json({ users: users.map(publicUser) })
  })

  app.post('/api/admin/users', async (c) => {
    requireAdmin(c)
    const body = await c.req.json().catch(() => ({}))
    const email = normalizeEmail(body.email)
    const name = String(body.name || '').trim()
    const role = body.role === 'admin' ? 'admin' : body.role === 'staff' ? 'staff' : ''
    const password = String(body.password || '')
    if (name.length < 2) throw new HttpError(400, 'Enter the person’s name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Enter a valid email.')
    if (!role) throw new HttpError(400, 'Choose admin or staff.')
    if (password.length < 8) throw new HttpError(400, 'Use a temporary password of at least 8 characters.')
    const now = new Date().toISOString()
    const created = {
      id: randomUUID(),
      name,
      email,
      role,
      password_hash: await hashPassword(password),
      created_at: now,
      updated_at: now
    }
    await store.updateUsers(async (users) => {
      if (users.some((item) => item.email === email)) throw new HttpError(409, 'That email already has an account.')
      users.push(created)
    })
    return c.json({ user: publicUser(created) })
  })

  app.post('/api/admin/users/:id', async (c) => {
    requireAdmin(c)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const action = String(body.action || '')
    let updated = null
    await store.updateUsers(async (users) => {
      const target = users.find((item) => item.id === id)
      if (!target) throw new HttpError(404, 'That account was not found.')
      const nextRole = body.role === 'admin' ? 'admin' : 'staff'
      assertUserChange(users, target, action === 'role' ? 'role' : action, nextRole)
      const now = new Date().toISOString()
      if (action === 'delete') {
        users.splice(users.indexOf(target), 1)
        updated = { deleted: true, id }
        return
      }
      if (action === 'role') {
        target.role = nextRole
        target.updated_at = now
        updated = publicUser(target)
        return
      }
      if (action === 'password') {
        const password = String(body.password || '')
        if (password.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.')
        target.password_hash = await hashPassword(password)
        target.updated_at = now
        updated = publicUser(target)
        return
      }
      throw new HttpError(400, 'Unknown account action.')
    })
    return c.json({ user: updated })
  })

  app.get('/api/admin/entries', async (c) => {
    const config = await liveConfig()
    const user = c.get('staff')
    let list = await freshLinks(await store.list(), c, fileSecret)
    if (user.role !== 'admin') {
      list = list.map((entry) => ({ ...entry, proof_link: '', proof_key: '' }))
    }
    return c.json({
      entries: list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      events: config.events.map(asPublic),
      liveSlug: config.liveSlug || '',
      hosts: versionRoots(requestBaseUrl(c)),
      storage: store.mode
    })
  })

  app.get('/api/admin/entries.csv', async (c) => {
    requireAdmin(c)
    const list = await freshLinks(await store.list(), c, fileSecret)
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', 'attachment; filename="sure-win-entries.csv"')
    return c.body(toCsv(list.map((entry) => ({ ...entry, site_mode: versionLabel(entry.site_mode) }))))
  })

  app.get('/api/admin/odds', async (c) => {
    requireAdmin(c)
    const config = await liveConfig()
    const list = await store.list()
    const slug = c.req.query('event') || config.events.find((event) => event.active)?.slug
    const event = slug ? findEvent(config, slug) : null
    const sold = event ? soldOutIds(list, event.slug, config) : []
    return c.json({ event: event ? asPublic(event) : null, soldOut: sold, odds: oddsTable(config, sold) })
  })

  app.get('/api/admin/outbox', async (c) => {
    requireAdmin(c)
    const records = await mailer.recent(50)
    return c.json({
      mode: mailer.mode,
      records: records.map((record) => ({
        id: record.id,
        at: record.at,
        to: record.to,
        subject: record.subject,
        status: record.status,
        error: record.error || '',
        text: record.text || ''
      }))
    })
  })

  app.post('/api/admin/entries/:id', async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) throw new HttpError(404, 'Entry not found.')
    const body = await c.req.json().catch(() => ({}))
    const actor = c.get('staff')
    const action = String(body.action || '')
    if (['void', 'undo-void', 'spam', 'undo-spam'].includes(action) && actor.role !== 'admin') {
      throw new HttpError(403, 'That needs an admin account.')
    }
    const entry = await store.transaction((list) => reviewEntry(list, id, action, new Date().toISOString(), actor.email))
    const [linked] = await freshLinks([entry], c, fileSecret)
    return c.json({ entry: actor.role === 'admin' ? linked : { ...linked, proof_link: '', proof_key: '' } })
  })

  app.get('/api/admin/kiosk-qr', async (c) => {
    requireAdmin(c)
    const config = await liveConfig()
    const requested = String(c.req.query('event') || '').trim()
    const event = requested ? findEvent(config, requested) : null
    if (requested && !event) throw new HttpError(404, 'Unknown event.')
    const map = await store.readKioskQr()
    const slug = event ? event.slug : (config.events.find((item) => item.active)?.slug || config.events[0]?.slug || '')
    const key = event ? event.slug : GLOBAL_EVENT
    return c.json({
      event: event ? asPublic(event) : null,
      saved: normalizeSaved(map[key]),
      resolved: resolveKioskQr(map, slug),
      env: envKioskQr(),
      limits: QR_LIMITS,
      events: config.events.map(asPublic)
    })
  })

  app.put('/api/admin/kiosk-qr', async (c) => {
    requireAdmin(c)
    const body = await c.req.json().catch(() => ({}))
    const config = await liveConfig()
    const requested = String(body.event || '').trim()
    let key = GLOBAL_EVENT
    if (requested) {
      const event = findEvent(config, requested)
      if (!event) throw new HttpError(400, 'Unknown event.')
      key = event.slug
    }
    const sized = clampSize(body.size, body.unit === 'px' ? 'px' : body.unit === 'percent' ? 'percent' : null)
    const position = parsePosition(body.position)
    if (!sized) throw new HttpError(400, `Size must be ${QR_LIMITS.percent[0]}–${QR_LIMITS.percent[1]}% of the screen width, or ${QR_LIMITS.px[0]}–${QR_LIMITS.px[1]} px.`)
    if (!position) throw new HttpError(400, 'Choose a position on the screen.')
    const saved = { ...sized, position, updatedAt: new Date().toISOString() }
    await store.updateKioskQr(key, saved)
    return c.json({ ok: true, event: requested || null, saved })
  })

  app.post('/api/admin/events', async (c) => {
    const actor = requireAdmin(c)
    const body = await c.req.json().catch(() => ({}))
    const name = cleanText(body.name, { min: 2, max: 80, label: 'the event name' })
    const date = assertEventDate(body.date)
    const config = await liveConfig()
    const taken = new Set(config.events.map((event) => event.slug))
    const slug = uniqueSlug(slugifyEventName(name), taken)
    const now = new Date().toISOString()
    const created = {
      slug,
      name,
      starts: date,
      ends: date,
      edition: '',
      active: true,
      created_at: now,
      created_by: actor.email
    }
    await store.updateEvents(async (events) => {
      if (events.some((event) => event.slug === slug)) throw new HttpError(409, 'That event name is already in use.')
      events.push(created)
    })
    return c.json({
      event: asPublic(created, 'event_day'),
      formUrl: linkFor(c, 'event_day', slug, 'form'),
      spinUrl: linkFor(c, 'event_day', slug, 'spin'),
      virtualFormUrl: linkFor(c, 'after_event', slug, 'form'),
      virtualSpinUrl: linkFor(c, 'after_event', slug, 'spin'),
      label: CREATE_EVENT_LABEL
    })
  })

  app.post('/api/admin/live', async (c) => {
    requireAdmin(c)
    const body = await c.req.json().catch(() => ({}))
    const slug = String(body.slug || '').trim()
    const config = await liveConfig()
    const event = findEvent(config, slug)
    if (!event || event.active === false) throw new HttpError(400, 'Choose an open event.')
    await store.setLiveSlug(slug)
    return c.json({ ok: true, liveSlug: slug })
  })

  app.get('/api/admin/qr/:slug', async (c) => {
    const config = await liveConfig()
    const event = findEvent(config, c.req.param('slug'))
    if (!event) throw new HttpError(404, 'Unknown event.')
    const forced = modeFromMount(c.req.query('mount'))
    const mode = forced || (event.mode ? eventMode(event) : 'event_day')
    return qrPng(c, linkFor(c, mode, event.slug, 'form'), `spin-${event.slug}.png`, { dark: '#1B0F33', light: '#FFFFFF' })
  })

  const htmlHeaders = { 'Cache-Control': 'no-cache' }
  const showForm = (c) => c.html(readPage('index.html'), 200, htmlHeaders)
  const showSpin = (c) => c.html(readPage('spin.html'), 200, htmlHeaders)
  app.get('/', (c) => c.redirect('/events', 302))
  app.get('/events', async (c) => {
    const event = pickLive(await liveConfig())
    if (!event) return showForm(c)
    return c.redirect(`/events/spin?event=${encodeURIComponent(event.slug)}`, 302)
  })
  app.get('/virtual', async (c) => {
    const event = pickLive(await liveConfig())
    if (!event) return showForm(c)
    return c.redirect(`/virtual/e/${encodeURIComponent(event.slug)}`, 302)
  })
  app.get('/events/spin', showSpin)
  app.get('/events/register', showForm)
  app.get('/events/e/:slug', showForm)
  app.get('/events/after/:slug', showForm)
  app.get('/virtual/spin', showSpin)
  app.get('/virtual/register', showForm)
  app.get('/virtual/e/:slug', showForm)
  app.get('/virtual/after/:slug', showForm)
  app.get('/register', (c) => c.redirect(`${prefixFor(fallbackMode())}/register`, 302))
  app.get('/spin', (c) => c.redirect(`/events/spin${new URL(c.req.url).search}`, 302))
  app.get('/e/:slug', async (c) => {
    const config = await liveConfig()
    const event = findEvent(config, c.req.param('slug'))
    const mode = eventMode(event, fallbackMode())
    return c.redirect(`${prefixFor(mode)}/e/${encodeURIComponent(c.req.param('slug'))}`, 302)
  })
  app.get('/after/:slug', (c) => c.redirect(`/virtual/e/${encodeURIComponent(c.req.param('slug'))}`, 302))
  app.get('/admin', (c) => c.html(readPage('admin.html'), 200, htmlHeaders))

  app.use('/css/*', serveStatic({ root: publicDir }))
  app.use('/js/*', serveStatic({ root: publicDir }))
  app.use('/img/*', serveStatic({ root: publicDir }))
  app.get('/wheel.svg', (c) => {
    c.header('Content-Type', 'image/svg+xml; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=3600')
    return c.body(fs.readFileSync(path.join(publicDir, 'wheel.svg')))
  })

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found.' }, 404)
    return c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found · Sure-Win Spin</title>
      <body style="font-family:'DM Sans',system-ui,sans-serif;background:#FFF8F1;color:#1B1714;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
      <div style="text-align:center;max-width:28rem"><h1 style="font-size:clamp(1.6rem,6vw,2.2rem);line-height:1.15">That page isn’t on the spin site.</h1><p style="font-size:1.05rem;display:flex;flex-wrap:wrap;gap:12px;justify-content:center"><a href="/" style="min-height:44px;display:inline-flex;align-items:center">Back to the form</a><a href="/spin" style="min-height:44px;display:inline-flex;align-items:center">Big screen</a></p></div></body></html>`, 404)
  })

  return app
}

function requireAdmin(c) {
  const user = c.get('staff')
  if (!user || user.role !== 'admin') throw new HttpError(403, 'That needs an admin account.')
  return user
}

function eventForScreen(config, slug) {
  const requested = String(slug || '').trim()
  if (requested) {
    const event = findEvent(config, requested)
    if (!event) throw new HttpError(404, 'That event link is not recognised.')
    return event
  }
  const event = pickLive(config)
  if (!event) throw new HttpError(404, 'No event is configured.')
  return event
}

function pickLive(config) {
  if (config.liveSlug) {
    const chosen = findEvent(config, config.liveSlug)
    if (chosen && chosen.active !== false) return chosen
  }
  return defaultEvent(config)
}


async function qrPng(c, url, filename, color = { dark: '#000000', light: '#FFFFFF' }) {
  const png = await QRCode.toBuffer(url, {
    width: 960,
    margin: 4,
    errorCorrectionLevel: 'H',
    color
  })
  c.header('Content-Type', 'image/png')
  c.header('Content-Disposition', `inline; filename="${filename}"`)
  c.header('Cache-Control', 'private, no-store')
  return c.body(png)
}

function remoteIp(c) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0].trim()
  }
  try {
    return getConnInfo(c).remote.address || 'local'
  } catch {
    return 'local'
  }
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

function mayForcePrize(c) {
  const ip = remoteIp(c)
  if (ip === 'local') return true
  return isLoopback(ip)
}

async function freshLinks(entries, c, secret) {
  const base = requestBaseUrl(c)
  return entries.map((entry) => {
    if (!entry.proof_key) return entry
    if (/^https?:\/\//i.test(String(entry.proof_link || ''))) return entry
    return { ...entry, proof_link: `${base}${proofPath(entry.proof_key, secret)}` }
  })
}

function oncePerEventIds(config) {
  return (config.prizes || []).filter((prize) => prize.oncePerEvent).map((prize) => prize.id)
}

async function sendProof(c, store, files, id) {
  const list = await store.list()
  const entry = list.find((row) => row.proof_key === id || row.id === id)
  const file = await files.read(id)
  if (!file) throw new HttpError(404, 'That file is no longer available.')
  const filename = entry?.proof_filename || 'proof'
  c.header('Content-Type', entry?.proof_mime || file.contentType || 'application/octet-stream')
  c.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'private, max-age=300')
  return c.body(file.buffer)
}

export function describeRuntime({ store, files, mailer }) {
  const storage = store.mode === 'sheets'
    ? `Google Sheet ${process.env.GOOGLE_SHEETS_ID}`
    : `local spreadsheet ${path.resolve(process.env.DATA_DIR || './data', 'entries.csv')}`
  const proofs = files.mode === 'r2' ? `R2 bucket ${process.env.R2_BUCKET}` : 'data/uploads on this computer'
  const email = mailer.mode === 'resend' ? 'Resend' : 'not configured (saved to the admin outbox)'
  return { storage, proofs, email }
}
