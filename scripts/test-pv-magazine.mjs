/**
 * Probe PV Magazine RSS feeds and verify the parser extracts items.
 * Run: node scripts/test-pv-magazine.mjs
 */

const FEEDS = [
  { region: 'global', url: 'https://www.pv-magazine.com/feed/' },
  { region: 'india', url: 'https://www.pv-magazine-india.com/feed/' },
]

function stripCDATA(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
function extract(tag, block) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = block.match(re)
  return m ? decodeEntities(stripCDATA(m[1])) : ''
}

async function probe(feed) {
  const started = Date.now()
  try {
    const res = await fetch(feed.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DealNectorBot/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    })
    const elapsed = Date.now() - started
    if (!res.ok) {
      console.log(`[${feed.region}] HTTP ${res.status} in ${elapsed}ms`)
      return
    }
    const xml = await res.text()
    const items = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m
    while ((m = itemRe.exec(xml))) {
      const block = m[1]
      items.push({
        title: extract('title', block),
        link: extract('link', block),
        pubDate: extract('pubDate', block),
        creator: extract('dc:creator', block),
      })
    }
    console.log(`\n[${feed.region}] ${res.status} in ${elapsed}ms · ${items.length} items · ${(xml.length / 1024).toFixed(1)}KB`)
    for (const it of items.slice(0, 5)) {
      console.log(` • ${new Date(it.pubDate).toISOString().slice(0, 16)} · ${it.title.slice(0, 90)}`)
      console.log(`   ${it.link}`)
    }
  } catch (e) {
    console.log(`[${feed.region}] FAILED:`, e.message)
  }
}

for (const feed of FEEDS) {
  await probe(feed)
}
