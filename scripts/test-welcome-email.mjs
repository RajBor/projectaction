import { readFileSync } from 'fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Welcome to DealNector</title>
<style>*{box-sizing:border-box}body{margin:0;padding:0;background-color:#F2EFE7}@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600;700&display=swap');</style></head>
<body style="margin:0;padding:0;background-color:#F2EFE7;font-family:'Inter','Helvetica Neue',Arial,sans-serif">
<center style="width:100%;background-color:#F2EFE7;padding:32px 16px">
<table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#FFFFFF;border-left:1px solid #E0DDD5;border-right:1px solid #E0DDD5">

<tr><td bgcolor="#051C2C" style="padding:28px 40px 24px;background-color:#051C2C">
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
<td width="40" valign="middle">
<div style="width:40px;height:46px;border:2px solid #C49A1A;display:flex;align-items:center;justify-content:center;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)"><span style="font-family:'Newsreader','Georgia',serif;font-size:18px;font-weight:700;font-style:italic;color:#C49A1A">D</span></div>
</td>
<td style="padding-left:10px" valign="middle">
<span style="font-family:'Newsreader','Georgia',serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#FFFFFF">Deal</span><span style="font-family:'Newsreader','Georgia',serif;font-size:22px;font-weight:700;letter-spacing:-0.5px;font-style:italic;color:#C49A1A">Nector</span>
<div style="font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:8px;letter-spacing:0.22em;text-transform:uppercase;color:#8899A8;margin-top:3px">Institutional &middot; Intelligence &middot; Terminal</div>
</td>
<td align="right" valign="middle"><span style="display:inline-block;background-color:#C49A1A;color:#1A1000;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:8px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:4px 10px">Access Granted</span></td>
</tr></table></td></tr>

<tr><td bgcolor="#051C2C" style="padding:48px 40px 52px;background-color:#051C2C;border-bottom:3px solid #C49A1A">
<p style="margin:0 0 16px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#9A6B00">Strategic Intelligence &middot; Welcome Dispatch</p>
<h1 style="margin:0 0 20px;font-family:'Newsreader','Georgia',serif;font-size:42px;font-weight:700;line-height:1.1;letter-spacing:-1px;color:#FFFFFF">The Signal You've<br/>Been Waiting For.</h1>
<p style="margin:0 0 24px;font-family:'Newsreader','Georgia',serif;font-size:20px;font-style:italic;color:#B3C9DE;line-height:1.4">Your intelligence terminal is active.</p>
<p style="margin:0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.75;color:#8899A8;max-width:480px">Welcome to DealNector &mdash; the platform where M&amp;A strategy meets real intelligence. You&rsquo;re now inside a system that reads industry shifts before they become consensus, maps valuation impact before it hits the news cycle, and identifies deal flow before the mandate is written.</p>
<table border="0" cellpadding="0" cellspacing="0" style="margin-top:36px"><tr>
<td bgcolor="#9A4600" style="background-color:#9A4600"><a href="https://dealnector.com" target="_blank" style="display:inline-block;padding:14px 32px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#FFFFFF;text-decoration:none">Enter Your Terminal &nbsp; &rarr;</a></td>
</tr></table>
</td></tr>

<tr><td bgcolor="#FCFAF3" style="padding:48px 40px 40px;background-color:#FCFAF3;border-left:4px solid #C49A1A">
<p style="margin:0 0 20px;font-family:'Newsreader','Georgia',serif;font-size:19px;font-weight:700;color:#051C2C;line-height:1.3">Good to have you here, Raj.</p>
<p style="margin:0 0 16px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.8;color:#3A3A35">Most platforms give you data. DealNector gives you a perspective on where the deals are heading &mdash; and more importantly, <em>why</em>.</p>
<p style="margin:0 0 16px;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.8;color:#3A3A35">You&rsquo;ll find live intelligence across four dimensions that traditional M&amp;A advisory consistently underweights: industry structure, policy headwinds, deal flow timing, and enterprise value sensitivity.</p>
<p style="margin:0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.8;color:#3A3A35">Below is a preview of what&rsquo;s waiting for you in your terminal.</p>
</td></tr>

<tr><td bgcolor="#FFFFFF" style="padding:0;background-color:#FFFFFF;border-top:1px solid #EDEBE3">
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
<td width="4" bgcolor="#051C2C" style="background-color:#051C2C"></td>
<td style="padding:32px 36px 32px 32px">
<span style="font-family:'Inter',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#9A4600">01 &middot; Industry Intelligence</span>
<h2 style="margin:8px 0 8px;font-family:'Newsreader','Georgia',serif;font-size:22px;font-weight:700;color:#051C2C">Industry Bottleneck Diagnostics</h2>
<p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.75;color:#4A4A45">Map where supply chains are fragile, where consolidation is inevitable, and where capital is mispriced. <strong>14 industries. Continuously updated.</strong></p>
</td></tr></table></td></tr>

<tr><td bgcolor="#051C2C" style="padding:0;background-color:#051C2C">
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
<td width="4" bgcolor="#C49A1A" style="background-color:#C49A1A"></td>
<td style="padding:32px 36px 32px 32px">
<span style="font-family:'Inter',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#C49A1A">02 &middot; Deal Intelligence</span>
<h2 style="margin:8px 0 8px;font-family:'Newsreader','Georgia',serif;font-size:22px;font-weight:700;color:#FFFFFF">M&amp;A Deal Flow &amp; Strategic Fit</h2>
<p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.75;color:#8899A8">Curated mandates aligned to your investment thesis &mdash; before they hit the open market.</p>
</td></tr></table></td></tr>

<tr><td bgcolor="#FFFFFF" style="padding:0;background-color:#FFFFFF;border-top:1px solid #EDEBE3">
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
<td width="4" bgcolor="#9A4600" style="background-color:#9A4600"></td>
<td style="padding:32px 36px 32px 32px">
<span style="font-family:'Inter',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#9A4600">03 &middot; Macro Intelligence</span>
<h2 style="margin:8px 0 8px;font-family:'Newsreader','Georgia',serif;font-size:22px;font-weight:700;color:#051C2C">Policy &amp; News Impact on Enterprise Value</h2>
<p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.75;color:#4A4A45">Every development scored by its downstream impact on enterprise value across sector clusters.</p>
</td></tr></table></td></tr>

<tr><td bgcolor="#FCFAF3" style="padding:0;background-color:#FCFAF3;border-top:1px solid #EDEBE3">
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
<td width="4" bgcolor="#B3C9DE" style="background-color:#B3C9DE"></td>
<td style="padding:32px 36px 32px 32px">
<span style="font-family:'Inter',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#34495B">04 &middot; Valuation Framework</span>
<h2 style="margin:8px 0 8px;font-family:'Newsreader','Georgia',serif;font-size:22px;font-weight:700;color:#051C2C">Macro-to-Micro Valuation Engine</h2>
<p style="margin:0;font-family:'Inter',sans-serif;font-size:13px;line-height:1.75;color:#4A4A45">See not just what a company is worth, but <em>why that number is moving</em> and in which direction.</p>
</td></tr></table></td></tr>

<tr><td bgcolor="#051C2C" style="padding:40px;background-color:#051C2C;border-top:3px solid #C49A1A;text-align:center">
<h3 style="margin:0 0 12px;font-family:'Newsreader','Georgia',serif;font-size:26px;font-weight:700;color:#FFFFFF">The terminal is live.</h3>
<p style="margin:0 0 28px;font-family:'Inter',sans-serif;font-size:13px;line-height:1.65;color:#8899A8;max-width:400px;margin-left:auto;margin-right:auto">Build the edge that comes from knowing the market &mdash; not just following it.</p>
<table border="0" cellpadding="0" cellspacing="0" align="center"><tr><td bgcolor="#9A4600" style="background-color:#9A4600"><a href="https://dealnector.com" target="_blank" style="display:inline-block;padding:16px 40px;font-family:'Inter',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#FFFFFF;text-decoration:none">Launch DealNector Terminal</a></td></tr></table>
</td></tr>

<tr><td bgcolor="#F6F3EB" style="padding:32px 40px;background-color:#F6F3EB;border-top:4px solid #051C2C">
<span style="font-family:'Newsreader','Georgia',serif;font-size:16px;font-weight:700;color:#051C2C">Deal</span><span style="font-family:'Newsreader','Georgia',serif;font-size:16px;font-weight:700;font-style:italic;color:#9A4600">Nector</span>
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="height:1px;background-color:#DDDAD2;line-height:1px;font-size:1px">&nbsp;</td></tr></table>
<p style="margin:0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;font-size:10px;line-height:1.7;color:#9A9A95">&copy; 2026 DealNector. Institutional M&amp;A Intelligence.<br/>This communication is intended for authorized users only.<br/>DealNector &middot; Intelligence Terminal &middot; For authorized institutional use.</p>
</td></tr>

</table></center></body></html>`

const res = await fetch('https://api.brevo.com/v3/smtp/email', {
  method: 'POST',
  headers: {
    'api-key': env.BREVO_API_KEY_WELCOME,
    'content-type': 'application/json',
    'accept': 'application/json',
  },
  body: JSON.stringify({
    sender: { name: 'DealNector', email: env.BREVO_SENDER_EMAIL },
    to: [{ email: 'rajbordia23@gmail.com', name: 'Raj Bordia' }],
    subject: 'Welcome to DealNector — Your Intelligence Terminal is Active',
    htmlContent: html,
  }),
})
console.log('Status:', res.status)
const body = await res.text()
console.log('Response:', body)
