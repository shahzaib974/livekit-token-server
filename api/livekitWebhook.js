// /api/livekitWebhook.js
const { WebhookReceiver } = require('livekit-server-sdk');
const { kv } = require('@vercel/kv');

// Vercel Node runtime (CJS is fine)
module.exports.config = { runtime: 'nodejs20.x' };

// --- helpers ---
function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return res.status(200).json(data ?? { ok: true });
}
function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- handler ---
module.exports = async (req, res) => {
  // CORS preflight (won’t be used by LiveKit, but safe for manual tests)
  if (req.method === 'OPTIONS') return ok(res);

  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return bad(res, 500, 'Missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  }

  // 1) Read RAW body for signature verification
  let rawBody;
  try {
    rawBody = await readRaw(req); // raw string
    if (!rawBody) rawBody = ''; // guard
  } catch (e) {
    return bad(res, 400, 'Unable to read raw body');
  }

  // 2) Validate signature & parse event
  let event;
  try {
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const auth = req.headers['authorization'] || '';
    event = receiver.receive(rawBody, auth); // returns WebhookEvent
  } catch (e) {
    // If you want to test manually without real signature, set DEV_BYPASS_SECRET
    if (process.env.DEV_BYPASS_SECRET && req.headers['x-dev-bypass'] === process.env.DEV_BYPASS_SECRET) {
      try { event = JSON.parse(rawBody || '{}'); } catch { event = {}; }
    } else {
      return bad(res, 401, 'Invalid webhook signature');
    }
  }

  // 3) Persist to KV
  try {
    const now = Date.now();
    const type = event?.event; // e.g. 'participant_joined'
    const roomKey = event?.room?.name || event?.room?.sid || '';
    const identity = event?.participant?.identity || '';
    const name = event?.participant?.name || ''; // LiveKit includes name+identity in webhooks

    // Minimal audit log for debugging (use a capped stream)
    await kv.lpush('lk:webhook:log', JSON.stringify({ t: now, type, roomKey, identity }));
    await kv.ltrim('lk:webhook:log', 0, 199); // keep last 200

    if (!roomKey) return ok(res, { ignored: true });

    const membersKey = `rk:${roomKey}:members`;

    if (type === 'participant_joined' && identity) {
      const baseKey = `rk:${roomKey}:${identity}`;
      const existing = await kv.hgetall(baseKey);
      await kv.hset(baseKey, {
        identity,
        name: name || existing?.name || '',
        totalMs: Number(existing?.totalMs || 0),
        lastJoinMs: now,
        lastSeenMs: now,
      });
      await kv.sadd(membersKey, identity);
    }

    if (type === 'participant_left' && identity) {
      const baseKey = `rk:${roomKey}:${identity}`;
      const lastJoinMs = Number((await kv.hget(baseKey, 'lastJoinMs')) || 0);
      const totalMs = Number((await kv.hget(baseKey, 'totalMs')) || 0);
      const delta = lastJoinMs ? Math.max(0, now - lastJoinMs) : 0;
      await kv.hset(baseKey, { totalMs: totalMs + delta, lastJoinMs: 0, lastSeenMs: now });
    }

    if (type === 'room_finished') {
      const ids = await kv.smembers(membersKey);
      for (const id of ids || []) {
        const baseKey = `rk:${roomKey}:${id}`;
        const lastJoinMs = Number((await kv.hget(baseKey, 'lastJoinMs')) || 0);
        if (lastJoinMs) {
          const totalMs = Number((await kv.hget(baseKey, 'totalMs')) || 0);
          const delta = Math.max(0, now - lastJoinMs);
          await kv.hset(baseKey, { totalMs: totalMs + delta, lastJoinMs: 0, lastSeenMs: now });
        }
      }
      // optional: stash a summary flag
      await kv.set(`rk:${roomKey}:finishedAt`, now);
    }

    return ok(res); // { ok: true }
  } catch (err) {
    return bad(res, 500, err?.message || 'internal');
  }
};

