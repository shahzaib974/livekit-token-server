module.exports.config = { runtime: 'nodejs20.x' };
const { kv } = require('@vercel/kv');

function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  return res.status(200).json(data ?? { ok: true });
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.setEncoding('utf8');
    req.on('data', c => s += c); req.on('end', () => resolve(s || ''));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return ok(res);
  const raw = await readRaw(req);
  // store last hit
  await kv.set('lk:echo:lastHeaders', JSON.stringify(req.headers, null, 2));
  await kv.set('lk:echo:lastRaw', raw.slice(0, 2000));
  await kv.lpush('lk:echo:log', JSON.stringify({ t: Date.now(), len: raw.length }));
  await kv.ltrim('lk:echo:log', 0, 50);
  return ok(res, { ok: true });
};
