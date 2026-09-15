const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const cache = new Map();

const SHORTENERS = {
  link4m: ['link4m.net', 'link4m.com', 'link4m.org'],
  layma: ['layma.net'],
  traffic4k: ['traffic4k.com'],
  site2s: ['site2s.com'],
  bbmkt: ['bbmkt.com'],
  trafficviet: ['app.trafficviet.vn', 'app.trafficviet.com'],
  phienchoso: ['phienchoso.com'],
  traffichub: ['system.traffichub.com', 'system.traffichub.vn', 'traffichub.com'],
};

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function detectShortener(url) {
  const l = url.toLowerCase();
  for (const [name, domains] of Object.entries(SHORTENERS)) {
    if (domains.some(d => l.includes(d))) return name;
  }
  return 'unknown';
}

function extractTarget(html) {
  const exclude = ['link4m', 'layma', 'traffic4k', 'site2s', 'bbmkt', 'trafficviet', 'phienchoso', 'traffichub', 'google', 'facebook', 'doubleclick', 'cloudflare', 'gstatic', 'youtube', 'w3.org', 'schema.org'];
  const isEx = (u) => exclude.some(d => u.toLowerCase().includes(d));

  const $ = cheerio.load(html);

  let t = null;
  $('input[type="hidden"]').each((i, el) => {
    const v = $(el).val();
    if (v && v.startsWith('http') && !isEx(v)) { t = v; return false; }
  });
  if (t) return t;

  const meta = $('meta[http-equiv="refresh"]').attr('content');
  if (meta) {
    const m = meta.match(/url=(.+)/i);
    if (m && !isEx(m[1])) return m[1].trim();
  }

  const anchors = $('a').toArray();
  for (const el of anchors) {
    const href = $(el).attr('href');
    const text = $(el).text().toLowerCase();
    if (href && href.startsWith('http') && !isEx(href)) {
      if (text.includes('get') || text.includes('link') || text.includes('continue') || text.includes('tải')) return href;
    }
  }

  const patterns = [
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i,
    /location\.(?:href|replace)\s*[=(]\s*['"](https?:\/\/[^'"]+)['"]/i,
    /"url"\s*:\s*"([^"]+)"/i,
    /var\s+(?:url|link|target|dest|go)\s*=\s*['"](https?:\/\/[^'"]+)['"]/i,
    /data-(?:url|link|target)=["'](https?:\/\/[^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] && m[1].startsWith('http') && !isEx(m[1])) return m[1];
  }

  const b64regex = /atob\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/g;
  let bm;
  while ((bm = b64regex.exec(html)) !== null) {
    try {
      const d = Buffer.from(bm[1], 'base64').toString('utf-8');
      if (d.startsWith('http') && !isEx(d)) return d;
    } catch (e) {}
  }

  return null;
}

async function bypass(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
    maxRedirects: 10,
    timeout: 20000,
    validateStatus: () => true,
  });

  const finalUrl = res.request?.res?.responseUrl;
  const sn = detectShortener(url);

  if (finalUrl && !SHORTENERS[sn]?.some(d => finalUrl.includes(d))) {
    return { success: true, target: finalUrl, method: 'redirect' };
  }

  if (res.data && typeof res.data === 'string') {
    const t = extractTarget(res.data);
    if (t) return { success: true, target: t, method: 'parse' };
  }

  return { success: false, error: 'Không tìm thấy link đích' };
}

app.get('/', (req, res) => res.json({ status: 'ok', shorteners: Object.keys(SHORTENERS) }));

app.get('/api/bypass', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ success: false, error: 'Missing ?url=' });

  if (cache.has(url)) return res.json({ ...cache.get(url), cached: true });

  try {
    const result = await bypass(url);
    if (result.success) cache.set(url, result);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
