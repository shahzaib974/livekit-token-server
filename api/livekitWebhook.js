// /api/livekitWebhook.js
// Vercel Edge Functions are great, but LiveKit signature verification
// needs the exact raw body with Node's crypto. Use Node runtime.
module.exports.config = { runtime: 'nodejs20.x' };

const { WebhookReceiver } = require('livekit-server-sdk');
const { kv } = require('@vercel/kv');

// ---------- helpers ----------
function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-dev-bypass');
  return res.status(200).json(data ?? { ok: true });
}
function bad(res, code, msg, extra) {
  return res.status(code).json({ error: msg, ...(extra || {}) });
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data || ''));
    req.on('error', reject);
  });
}

// ---------- main handler ----------
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return ok(res); // CORS preflight
  if (req.method !== 'POST') return bad(res, 405, 'Method Not Allowed');

  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEV_BYPASS_SECRET } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return bad(res, 500, 'Missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  }

  // 1) Read the RAW body (required for signature verification)
  let rawBody = '';
  try {
    rawBody = await readRaw(req);
  } catch {
    return bad(res, 400, 'Unable to read raw request body');
  }

  // 2) Verify signature OR use dev-bypass for manual tests
  const auth = req.headers['authorization'] || '';
  let event;
  try {
    if (!auth) throw new Error('NO_AUTH_HEADER');
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    event = receiver.receive(rawBody, auth); // throws if invalid
  } catch (e) {
    const bypass = req.headers['x-dev-bypass'] || '';
    if (DEV_BYPASS_SECRET && bypass === DEV_BYPASS_SECRET) {
      try {
        event = JSON.parse(rawBody || '{}');
      } catch {
        return bad(res, 400, 'Invalid JSON in dev-bypass body');
      }
    } else {
      return bad(
        res,
        401,
        e?.message === 'NO_AUTH_HEADER'
          ? 'Missing Authorization (LiveKit) and no valid dev bypass'
          : 'Invalid webhook signature'
      );
    }
  }

  // 3) Minimal schema normalization
  const now = Date.now();
  const type = event?.event || '';
  const roomKey = event?.room?.name || event?.room?.sid || '';
  const identity = event?.participant?.identity || '';

  // Some LiveKit webhooks include participant.name; metadata may carry your app profile.
  let profile = {};
  if (event?.participant?.metadata) {
    try { profile = JSON.parse(event.participant.metadata); } catch {}
  }
  const nameFromEvent = event?.participant?.name || profile?.name || '';

  // Rolling audit log (last 200 entries)
  try {
    await kv.lpush('lk:webhook:log', JSON.stringify({ t: now, type, roomKey, identity }));
    await kv.ltrim('lk:webhook:log', 0, 199);
  } catch (e) {
    // Don’t fail the request just because logging failed
  }

  // If there is no room key, fail loudly so you notice during testing
  if (!roomKey) {
    // optional: store raw for debugging
    await kv.set('lk:debug:noRoom:raw', rawBody.slice(0, 1000));
    await kv.set('lk:debug:noRoom:event', JSON.stringify(event).slice(0, 1000));
    return bad(res, 400, 'No room.name or room.sid in payload');
  }

  // 4) Persist attendance into Upstash KV
  try {
    const membersKey = `rk:${roomKey}:members`;

    if (type === 'participant_joined' && identity) {
      const baseKey = `rk:${roomKey}:${identity}`;
      const existing = await kv.hgetall(baseKey);
      await kv.hset(baseKey, {
        identity,
        name: nameFromEvent || existing?.name || '',
        avatar: profile?.avatar || existing?.avatar || '',
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
      await kv.hset(baseKey, {
        totalMs: totalMs + delta,
        lastJoinMs: 0,
        lastSeenMs: now,
      });
    }

    if (type === 'room_finished') {
      // finalize any participants still "joined"
      const ids = (await kv.smembers(membersKey)) || [];
      for (const id of ids) {
        const baseKey = `rk:${roomKey}:${id}`;
        const lastJoinMs = Number((await kv.hget(baseKey, 'lastJoinMs')) || 0);
        if (lastJoinMs) {
          const totalMs = Number((await kv.hget(baseKey, 'totalMs')) || 0);
          const delta = Math.max(0, now - lastJoinMs);
          await kv.hset(baseKey, { totalMs: totalMs + delta, lastJoinMs: 0, lastSeenMs: now });
        }
      }
      await kv.set(`rk:${roomKey}:finishedAt`, now);
    }

    // (optional) handle other events if you care:
    // - room_started
    // - participant_metadata_updated
    // - track_published / track_unpublished
    // etc.

    return ok(res); // { ok: true }
  } catch (err) {
    return bad(res, 500, err?.message || 'internal');
  }
};

