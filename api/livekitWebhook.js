// /api/livekitWebhook.js
const { WebhookReceiver } = require('livekit-server-sdk'); // for verification
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
    return bad(res, 500, 'Server misconfigured: missing LiveKit keys');
  }

  // Verify webhook signature (recommended)
  const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

  let event;
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const auth = req.headers['authorization'] || '';
    event = receiver.receive(body, auth);
  } catch (e) {
    return bad(res, 401, 'Invalid webhook signature');
  }

  try {
    const type = event.event;
    // Common payload fields:
    // event.room.name, event.room.sid
    // event.participant.identity, event.participant.metadata (string)
    const room = event.room?.name || '';
    const identity = event.participant?.identity || '';

    if (!room || !identity) return ok(res); // ignore

    // Parse profile/metadata once (keep it with the stats)
    let profile = {};
    if (event.participant?.metadata) {
      try { profile = JSON.parse(event.participant.metadata); } catch (_) {}
    }

    // Keys in KV
    const baseKey = `rk:${room}:${identity}`;
    const membersKey = `rk:${room}:members`;

    const nowMs = Date.now();

    if (type === 'participant_joined') {
      // create/merge profile, set lastJoinMs, ensure member is tracked
      await kv.hset(baseKey, {
        name: profile.name || '',
        avatar: profile.avatar || '',
        communityId: profile.communityId || '',
        communityName: profile.communityName || '',
        totalMs: (await kv.hget(baseKey, 'totalMs')) || 0,
        lastJoinMs: nowMs,
      });
      await kv.sadd(membersKey, identity);
    }

    if (type === 'participant_left') {
      // add session duration
      const lastJoinMs = Number(await kv.hget(baseKey, 'lastJoinMs') || 0);
      const totalMs = Number(await kv.hget(baseKey, 'totalMs') || 0);
      const delta = lastJoinMs ? Math.max(0, nowMs - lastJoinMs) : 0;
      await kv.hset(baseKey, { totalMs: totalMs + delta, lastJoinMs: 0 });
    }

    if (type === 'room_finished') {
      // finalize any users that never emitted 'left'
      const ids = await kv.smembers(membersKey);
      for (const id of ids) {
        const k = `rk:${room}:${id}`;
        const lastJoinMs = Number(await kv.hget(k, 'lastJoinMs') || 0);
        if (lastJoinMs) {
          const totalMs = Number(await kv.hget(k, 'totalMs') || 0);
          const delta = Math.max(0, nowMs - lastJoinMs);
          await kv.hset(k, { totalMs: totalMs + delta, lastJoinMs: 0 });
        }
      }
    }

    return ok(res);
  } catch (err) {
    return bad(res, 500, err?.message || 'internal');
  }
};
