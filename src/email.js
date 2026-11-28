import fs from 'node:fs'
import path from 'node:path'
import nodemailer from 'nodemailer'
import { formatCode } from './codes.js'

export function fromAddress() {
  return process.env.EMAIL_FROM || 'IDLah Sure-Win <idlah.logistics@gmail.com>'
}

export function smtpConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

export function gmailApiConfigured() {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN)
}

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY || smtpConfigured() || gmailApiConfigured())
}

export function mailMode() {
  if (process.env.RESEND_API_KEY) return 'resend'
  if (smtpConfigured()) return 'smtp'
  if (gmailApiConfigured()) return 'gmail'
  return 'log'
}

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function deliver(message) {
  const mode = mailMode()
  if (mode === 'resend') return sendResend(message)
  if (mode === 'smtp') return sendSmtp(message)
  if (mode === 'gmail') return sendGmail(message)
}

async function sendResend(message) {
  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text
    })
  }, 10000)
  if (!response.ok) throw new Error((await response.text()).slice(0, 500) || `Resend HTTP ${response.status}`)
}

function smtpTransport(port, secure) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port,
    secure,
    requireTLS: !secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  })
}

function smtpTimedOut(error) {
  const text = String(error && (error.message || error.code) || error)
  return /timeout|ETIMEDOUT|ESOCKET/i.test(text)
}

async function sendSmtp(message) {
  const mail = {
    from: fromAddress(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html
  }
  try {
    await smtpTransport(465, true).sendMail(mail)
  } catch (primary) {
    if (smtpTimedOut(primary)) throw primary
    try {
      await smtpTransport(587, false).sendMail(mail)
    } catch (fallback) {
      throw new Error(`SMTP 465: ${primary.message}; SMTP 587: ${fallback.message}`)
    }
  }
}

function encodeRfc822(message) {
  const from = fromAddress()
  const lines = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="surewin"',
    '',
    '--surewin',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    message.text || '',
    '--surewin',
    'Content-Type: text/html; charset=UTF-8',
    '',
    message.html || '',
    '--surewin--',
    ''
  ]
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

async function sendGmail(message) {
  const tokenResponse = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  }, 10000)
  const tokenBody = await tokenResponse.json().catch(() => ({}))
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || tokenBody.error || `Gmail token HTTP ${tokenResponse.status}`)
  }
  const response = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenBody.access_token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ raw: encodeRfc822(message) })
  }, 10000)
  if (!response.ok) throw new Error((await response.text()).slice(0, 500) || `Gmail HTTP ${response.status}`)
}

export function createMailer(dir) {
  const file = path.join(dir, 'outbox.json')
  return {
    get mode() { return mailMode() },
    file,
    async send(message) {
      const record = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        status: mailMode() === 'log' ? 'logged' : 'failed',
        error: ''
      }
      if (mailMode() !== 'log') {
        try {
          await deliver(message)
          record.status = 'sent'
        } catch (error) {
          if (mailMode() === 'smtp' && gmailApiConfigured()) {
            try {
              await sendGmail(message)
              record.status = 'sent'
              record.error = ''
            } catch (gmailError) {
              record.error = `SMTP: ${String(error && error.message ? error.message : error).slice(0, 240)}; Gmail API: ${String(gmailError && gmailError.message ? gmailError.message : gmailError).slice(0, 240)}`
              console.error('Email failed', message.to, record.error)
            }
          } else {
            record.status = 'failed'
            record.error = String(error && error.message ? error.message : error).slice(0, 500)
            console.error('Email failed', message.to, record.error)
          }
        }
      } else {
        console.log(`[email not configured] To ${message.to} — ${message.subject}`)
      }
      await remember(file, record)
      return record
    },
    async recent(limit = 50) {
      const all = await readOutbox(file)
      return all.slice(-limit).reverse()
    }
  }
}

async function readOutbox(file) {
  try {
    const raw = await fs.promises.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let outboxChain = Promise.resolve()

async function writeOutbox(file, record) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const all = await readOutbox(file)
  all.push(record)
  const trimmed = all.slice(-200)
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(trimmed, null, 2))
  await fs.promises.rename(tmp, file)
}

function remember(file, record) {
  const run = outboxChain.then(() => writeOutbox(file, record))
  outboxChain = run.then(() => {}, () => {})
  return run
}

export function codeEmail({ entry, spinUrl, whatsapp, mode }) {
  const pretty = formatCode(entry.code)
  const subject = `Your Sure-Win Spin code · ${entry.event_name}`
  const where = mode === 'after_event'
    ? `Open this link on your phone to spin: ${spinUrl}`
    : `At the event, type it on the big screen to spin. Spin page: ${spinUrl}`
  const text = [
    `Your Sure-Win Spin code is ${pretty}.`,
    '',
    'Screenshot this email or write the code down.',
    where,
    '',
    `Event: ${entry.event_name}${entry.event_edition ? ` (${entry.event_edition})` : ''}`,
    `Date attended: ${entry.event_date}`,
    `Name: ${entry.homeowner_name}`,
    '',
    'The code works once. Type it on the big screen and spin. The designer’s details are already saved with this entry.',
    `Questions? WhatsApp https://wa.me/${whatsapp}`
  ].join('\n')
  const html = wrapHtml(`
    <p style="font-size:15px;margin:0 0 8px">Your Sure-Win Spin code</p>
    <p style="font-size:36px;font-weight:900;letter-spacing:.12em;margin:0 0 12px">${escapeHtml(pretty)}</p>
    <p>Screenshot this email or write the code down. ${mode === 'after_event' ? `Spin on your phone: <a href="${escapeHtml(spinUrl)}">open the wheel</a>.` : 'At the event, type it on the big screen.'} The code works once.</p>
    <p><a href="${escapeHtml(spinUrl)}">Open the spin page</a></p>
    <p><b>Event.</b> ${escapeHtml(entry.event_name)}${entry.event_edition ? ` (${escapeHtml(entry.event_edition)})` : ''}<br>
    <b>Date attended.</b> ${escapeHtml(entry.event_date)}<br>
    <b>Name.</b> ${escapeHtml(entry.homeowner_name)}</p>
    <p>${mode === 'after_event' ? 'The spin link above opens the wheel on your phone with this code ready.' : 'Type the code on the big screen and spin.'} The designer’s details are already saved with this entry. Questions? <a href="https://wa.me/${whatsapp}">WhatsApp us</a>.</p>
  `)
  return { to: entry.homeowner_email, subject, text, html }
}

export function resultEmails({ entry, spinUrl, whatsapp }) {
  const pretty = formatCode(entry.code)
  const subject = `You won ${entry.prize_label} · Sure-Win Spin`
  const summary = [
    `Prize: ${entry.prize_label} (${entry.prize_brand})`,
    `Spin code: ${pretty}`,
    `Event: ${entry.event_name}${entry.event_edition ? ` (${entry.event_edition})` : ''}`,
    `Date attended: ${entry.event_date}`,
    `Homeowner: ${entry.homeowner_name}, ${entry.homeowner_phone}, ${entry.homeowner_email}`,
    `Interior designer: ${entry.designer_name}, ${entry.designer_phone}, ${entry.designer_email}`,
    `ID company: ${entry.id_company}`,
    '',
    'The prize is delivered to the interior designer. The designer passes it to the homeowner once the signed contract is confirmed. If the contract is cancelled, the prize must be returned to IDLah.',
    `Spin page: ${spinUrl}`,
    `Questions? WhatsApp https://wa.me/${whatsapp}`
  ].join('\n')
  const html = wrapHtml(`
    <p style="letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#E6246E;font-size:13px;margin:0">Congratulations</p>
    <h1 style="font-size:28px;margin:8px 0 12px">You won ${escapeHtml(entry.prize_label)}</h1>
    <p><b>Spin code.</b> ${escapeHtml(pretty)}</p>
    <p><b>Event.</b> ${escapeHtml(entry.event_name)}${entry.event_edition ? ` (${escapeHtml(entry.event_edition)})` : ''}<br>
    <b>Date attended.</b> ${escapeHtml(entry.event_date)}</p>
    <p><b>Homeowner.</b> ${escapeHtml(entry.homeowner_name)} · ${escapeHtml(entry.homeowner_phone)} · ${escapeHtml(entry.homeowner_email)}</p>
    <p><b>Interior designer.</b> ${escapeHtml(entry.designer_name)} · ${escapeHtml(entry.designer_phone)} · ${escapeHtml(entry.designer_email)}<br>
    <b>ID company.</b> ${escapeHtml(entry.id_company)}</p>
    <p>The prize is delivered to the interior designer, and handed to the homeowner once the signed contract is confirmed. If the contract is cancelled, the prize must be returned to IDLah.</p>
    <p><a href="${escapeHtml(spinUrl)}">Spin page</a> · <a href="https://wa.me/${whatsapp}">WhatsApp us</a></p>
  `)
  const recipients = [entry.homeowner_email]
  if (entry.designer_email && entry.designer_email !== entry.homeowner_email) {
    recipients.push(entry.designer_email)
  }
  return recipients.map((to) => ({ to, subject, text: summary, html }))
}

function wrapHtml(inner) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#FFF8F1;font-family:'DM Sans',Arial,sans-serif;color:#1B1714">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:28px;border:1px solid rgba(27,23,20,.12)">
    <div style="font-weight:900;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:#E90B01">Sure-Win Spin · IDLah</div>
    ${inner}
  </div></body></html>`
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]))
}
