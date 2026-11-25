import fs from 'node:fs'
import path from 'node:path'
import { formatCode } from './codes.js'

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY
}

export function createMailer(dir) {
  const file = path.join(dir, 'outbox.json')
  return {
    mode: emailConfigured() ? 'resend' : 'log',
    file,
    async send(message) {
      const record = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        status: emailConfigured() ? 'failed' : 'logged',
        error: ''
      }
      if (emailConfigured()) {
        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM || 'IDLah Sure-Win <spin@example.com>',
              to: [message.to],
              subject: message.subject,
              html: message.html,
              text: message.text
            }),
            signal: AbortSignal.timeout(8000)
          })
          if (response.ok) {
            record.status = 'sent'
          } else {
            record.status = 'failed'
            record.error = (await response.text()).slice(0, 500)
            console.error('Email failed', message.to, record.error)
          }
        } catch (error) {
          record.status = 'failed'
          record.error = error.message
          console.error('Email failed', message.to, error.message)
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

async function remember(file, record) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const all = await readOutbox(file)
  all.push(record)
  const trimmed = all.slice(-200)
  const tmp = `${file}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(trimmed, null, 2))
  await fs.promises.rename(tmp, file)
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
    `Prize delivery address: ${entry.delivery_address}`,
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
    <p><b>Homeowner.</b> ${escapeHtml(entry.homeowner_name)} · ${escapeHtml(entry.homeowner_phone)} · ${escapeHtml(entry.homeowner_email)}<br>
    <b>Prize delivery address.</b> ${escapeHtml(entry.delivery_address)}</p>
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
