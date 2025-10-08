// /api/livekitWebhook.js
const { WebhookReceiver } = require('livekit-server-sdk');
const { kv } = require('@vercel/kv');

module.exports.config = { runtime: 'nodejs20.x' };

function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return res.status(200).json(data || { ok: true });
}
function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return ok(res);
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return bad(res, 500, 'Missing LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  }

  // Verify signature
  let event;
  try {
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const auth = req.headers['authorization'] || '';
    event = receiver.receive(raw, auth);
  } catch (e) {
    return bad(res, 401, 'Invalid webhook signature');
  }

  try {
    const now = Date.now();
    const type = event.event;

    // Prefer room.name; fallback to room.sid
    const roomKey = event.room?.name || event.room?.sid || '';
    const identity = event.participant?.identity || '';
    if (!roomKey) return ok(res); // nothing to do

    // Helpful metadata (optional): encode profile in token metadata JSON
    let profile = {};
    if (event.participant?.metadata) {
      try { profile = JSON.parse(event.participant.metadata); } catch (_) {}
    }

    const membersKey = `rk:${roomKey}:members`;

    if (type === 'participant_joined' && identity) {
      const baseKey = `rk:${roomKey}:${identity}`;
      const existing = await kv.hgetall(baseKey);

      // Start (or restart) a session
      await kv.hset(baseKey, {
        name: profile.name || existing?.name || '',
        avatar: profile.avatar || existing?.avatar || '',
        communityId: profile.communityId || existing?.communityId || '',
        communityName: profile.communityName || existing?.communityName || '',
        totalMs: Number(existing?.totalMs || 0),
        lastJoinMs: now,
      });
      await kv.sadd(membersKey, identity);
    }

    if (type === 'participant_left' && identity) {
      const baseKey = `rk:${roomKey}:${identity}`;
      const lastJoinMs = Number(await kv.hget(baseKey, 'lastJoinMs') || 0);
      const totalMs = Number(await kv.hget(baseKey, 'totalMs') || 0);
      const delta = lastJoinMs ? Math.max(0, now - lastJoinMs) : 0;
      await kv.hset(baseKey, { totalMs: totalMs + delta, lastJoinMs: 0 });
    }

    if (type === 'room_finished') {
      // Finalize any participants who never emitted 'left'
      const ids = await kv.smembers(membersKey);
      for (const id of ids) {
        const baseKey = `rk:${roomKey}:${id}`;
        const lastJoinMs = Number(await kv.hget(baseKey, 'lastJoinMs') || 0);
        if (lastJoinMs) {
          const totalMs = Number(await kv.hget(baseKey, 'totalMs') || 0);
          const delta = Math.max(0, now - lastJoinMs);
          await kv.hset(baseKey, { totalMs: totalMs + delta, lastJoinMs: 0 });
        }
      }
    }

    return ok(res);
  } catch (err) {
    return bad(res, 500, err?.message || 'internal');
  }
};
