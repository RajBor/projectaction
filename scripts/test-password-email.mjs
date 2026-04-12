import { readFileSync } from 'fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>DealNector — Password Reset</title>
<style>*{box-sizing:border-box}body{margin:0;padding:0;background-color:#F2EFE7}@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,600;0,700;1,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@600;700&display=swap');</style></head>
<body style="margin:0;padding:0;background-color:#F2EFE7;font-family:'Inter','Helvetica Neue',Arial,sans-serif">
<center style="width:100%;background-color:#F2EFE7;padding:32px 16px">
<table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#FFFFFF;border:1px solid #E0DDD5">

<tr><td bgcolor="#051C2C" style="padding:24px 40px;background-color:#051C2C">
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
<td valign="middle"><span style="font-family:'Newsreader','Georgia',serif;font-size:20px;font-weight:700;color:#FFFFFF">Deal</span><span style="font-family:'Newsreader','Georgia',serif;font-size:20px;font-weight:700;font-style:italic;color:#C49A1A">Nector</span></td>
<td align="right" valign="middle"><span style="display:inline-block;background-color:#9A2200;color:#FFFFFF;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:8px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:4px 10px">Security Alert</span></td>
</tr></table></td></tr>

<tr><td style="padding:48px 40px 40px;background-color:#FFFFFF">
<p style="margin:0 0 8px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#9A4600">Password Reset Request</p>
<h1 style="margin:0 0 20px;font-family:'Newsreader','Georgia',serif;font-size:30px;font-weight:700;line-height:1.15;color:#051C2C;letter-spacing:-0.5px">Your authentication code</h1>
<p style="margin:0 0 32px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.75;color:#4A4A45">We received a request to reset the password for <strong style="color:#051C2C">rajbordia23@gmail.com</strong>. Use the code below to complete the process. This code expires in <strong>15 minutes</strong>.</p>

<table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:32px"><tr>
<td align="center" style="padding:28px 0;background-color:#051C2C;border-left:4px solid #C49A1A">
<span style="font-family:'JetBrains Mono','Courier New',monospace;font-size:44px;font-weight:700;letter-spacing:0.5em;color:#C49A1A;display:inline-block;padding:0 16px">AB12CD</span>
</td></tr></table>

<p style="margin:0 0 16px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.75;color:#4A4A45">Enter this code in the password change form on the DealNector admin panel. Do not share this code with anyone.</p>

<table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;background-color:#FFF8F0;border:1px solid #E8D5C0;border-left:3px solid #9A4600"><tr><td style="padding:14px 16px">
<p style="margin:0 0 4px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#9A4600">Didn&rsquo;t request this?</p>
<p style="margin:0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.65;color:#73777D">If you did not request a password reset, you can safely ignore this email. Your password will not be changed. If you suspect unauthorized access, contact the platform administrator immediately.</p>
</td></tr></table>
</td></tr>

<tr><td bgcolor="#F6F3EB" style="padding:24px 40px;background-color:#F6F3EB;border-top:3px solid #051C2C">
<span style="font-family:'Newsreader','Georgia',serif;font-size:14px;font-weight:700;color:#051C2C">Deal</span><span style="font-family:'Newsreader','Georgia',serif;font-size:14px;font-weight:700;font-style:italic;color:#9A4600">Nector</span>
<p style="margin:8px 0 0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:10px;line-height:1.7;color:#9A9A95">&copy; 2026 DealNector. All rights reserved.<br/>Institutional M&amp;A Intelligence. This is an automated security email. Do not reply.</p>
<p style="margin:6px 0 0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:10px;line-height:1.7"><a href="https://www.dealnector.com" target="_blank" style="color:#9A4600;text-decoration:underline">www.dealnector.com</a></p>
</td></tr>

</table></center></body></html>`

const res = await fetch('https://api.brevo.com/v3/smtp/email', {
  method: 'POST',
  headers: {
    'api-key': env.BREVO_API_KEY_PASSWORD,
    'content-type': 'application/json',
    'accept': 'application/json',
  },
  body: JSON.stringify({
    sender: { name: 'DealNector', email: env.BREVO_SENDER_EMAIL },
    to: [{ email: 'rajbordia23@gmail.com', name: 'Raj Bordia' }],
    subject: 'DealNector · Password Reset Code',
    htmlContent: html,
  }),
})
console.log('Status:', res.status)
const body = await res.text()
console.log('Response:', body)
