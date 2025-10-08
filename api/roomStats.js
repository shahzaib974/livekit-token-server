// /api/roomStats.js
const { kv } = require('@vercel/kv');

module.exports.config = { runtime: 'nodejs20.x' };

function bad(res, code, msg) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(code).json({ error: msg });
}
function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(200).json(data);
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return ok(res, {});
  const room = (req.query?.room || '').toString().trim();
  if (!room) return bad(res, 400, 'Missing room');

  try {
    const membersKey = `rk:${room}:members`;
    const ids = await kv.smembers(membersKey); // list of identities
    const nowMs = Date.now();

    const rows = [];
    for (const identity of ids) {
      const baseKey = `rk:${room}:${identity}`;
      const h = await kv.hgetall(baseKey);

      // compute current total including an ongoing session if any
      let totalMs = Number(h?.totalMs || 0);
      const lastJoinMs = Number(h?.lastJoinMs || 0);
      if (lastJoinMs) totalMs += Math.max(0, nowMs - lastJoinMs);

      rows.push({
        identity,
        name: h?.name || '',
        avatar: h?.avatar || '',
        communityId: h?.communityId || '',
        communityName: h?.communityName || '',
        totalSeconds: Math.round(totalMs / 1000),
      });
    }

    rows.sort((a, b) => b.totalSeconds - a.totalSeconds);

    return ok(res, { room, count: rows.length, participants: rows });
  } catch (e) {
    return bad(res, 500, e?.message || 'internal');
  }
};
