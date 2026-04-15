#!/usr/bin/env node
// One-shot test dispatcher for the DealNector welcome email.
// Reads env from .env.local, loads the real welcome template, and hits
// Brevo end-to-end. Usage:
//   node scripts/send-test-email.mjs [recipient@example.com]
// If no recipient is passed, defaults to the platform admin email.

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

// ── Parse .env.local (no dotenv dep — keep this script zero-install) ──
const envPath = path.join(repoRoot, '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}

const TO = process.argv[2] || 'abhilasharajbordia@gmail.com'
const KEY = process.env.BREVO_API_KEY_WELCOME
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'info@dealnector.com'
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'DealNector'
const LOGIN_URL = process.env.NEXTAUTH_URL || 'https://dealnector.com'

if (!KEY) {
  console.error('❌ BREVO_API_KEY_WELCOME is not set in environment / .env.local')
  process.exit(1)
}

// ── Load the welcome template ──
// The template is a TS module; we inline a faithful copy here so this
// script runs without a TS toolchain. If you edit the real template,
// mirror the change below (it's only used for infra sanity checks).
const AUTH_CODE = 'TEST42'
const FIRST_NAME = 'Test Admin'
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DealNector welcome email preview</title>
</head>
<body style="margin:0; padding:0; background:#F2EFE7; font-family:'Inter',Arial,sans-serif;">
<center style="width:100%; background:#F2EFE7; padding:32px 16px;">
  <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#fff;border:1px solid #E0DDD5;">
    <tr>
      <td bgcolor="#051C2C" style="padding:36px 40px;color:#fff;border-bottom:3px solid #C49A1A;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:#C49A1A;margin-bottom:8px;">DealNector &middot; Welcome Dispatch</div>
        <h1 style="margin:0 0 14px;font-family:'Newsreader',Georgia,serif;font-size:32px;line-height:1.15;color:#fff;">The Signal You've Been Waiting For.</h1>
        <p style="margin:0;color:#B3C9DE;font-size:14px;line-height:1.7;">This is a <strong>test dispatch</strong> from the DealNector admin console. It exercises the real Brevo API key, sender verification, and HTML template used for approved signups.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 40px;">
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#3A3A35;">Hi ${FIRST_NAME},</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#3A3A35;">If you are reading this, the welcome-email pipeline is working end-to-end. Below is a sample of the authentication code block that new users will receive on approval.</p>
      </td>
    </tr>
    <tr>
      <td bgcolor="#051C2C" style="padding:28px 40px;text-align:center;color:#fff;">
        <div style="font-size:9px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:#C49A1A;margin-bottom:8px;">Authentication Code (sample)</div>
        <div style="display:inline-block;padding:14px 32px;background:rgba(196,154,26,0.1);border:2px solid #C49A1A;border-radius:8px;font-family:'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:0.3em;color:#C49A1A;">${AUTH_CODE}</div>
        <p style="margin:12px 0 0;color:#8899A8;font-size:12px;">Real approval emails will contain each user's unique one-time code.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 40px;background:#FCFAF3;border-left:4px solid #C49A1A;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#4A4A45;">Login URL configured: <a href="${LOGIN_URL}" style="color:#9A4600;">${LOGIN_URL}</a></p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 40px;background:#F6F3EB;font-size:10px;color:#9A9A95;border-top:4px solid #051C2C;">
        DealNector &copy; ${new Date().getFullYear()} &middot; Test dispatch &middot; ${new Date().toISOString()}
      </td>
    </tr>
  </table>
</center>
</body>
</html>`

const body = {
  sender: { name: SENDER_NAME, email: SENDER_EMAIL },
  to: [{ email: TO, name: 'Test Recipient' }],
  subject: '[TEST] DealNector welcome email preview',
  htmlContent: html,
  tags: ['test', 'welcome-preview'],
}

console.log(`→ Sending test welcome email`)
console.log(`  from   : ${SENDER_NAME} <${SENDER_EMAIL}>`)
console.log(`  to     : ${TO}`)
console.log(`  loginUrl: ${LOGIN_URL}`)
console.log(`  key    : ${KEY.slice(0, 10)}…${KEY.slice(-4)}`)

const res = await fetch('https://api.brevo.com/v3/smtp/email', {
  method: 'POST',
  headers: {
    'api-key': KEY,
    'content-type': 'application/json',
    accept: 'application/json',
  },
  body: JSON.stringify(body),
})

const text = await res.text()
if (!res.ok) {
  console.error(`❌ Brevo rejected the send — HTTP ${res.status}`)
  console.error(text)
  process.exit(2)
}
console.log(`✅ Brevo accepted the send — HTTP ${res.status}`)
console.log(text)
console.log(`\nNext: check the ${TO} inbox (and spam folder) for the test welcome email.`)
