// api/removeParticipant.js
const { RoomServiceClient } = require('livekit-server-sdk');

module.exports.config = { runtime: 'nodejs20.x' };

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}

module.exports = async (req, res) => {
  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      return bad(res, 405, 'POST only');
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WS_URL } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
      return bad(res, 500, 'Server misconfigured: missing LIVEKIT env vars');
    }

    // Accept JSON from GET query or POST body (mirror your token endpoint)
    const src = req.method === 'GET' ? req.query : (req.body || {});
    const room = String(src.room || '').trim();
    const identity = String(src.identity || '').trim();

    if (!room) return bad(res, 400, 'Missing room');
    if (!identity) return bad(res, 400, 'Missing identity');

    const svc = new RoomServiceClient(
      LIVEKIT_WS_URL,
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );

    // Kick the participant (disconnects them immediately)
    await svc.removeParticipant(room, identity);

    // CORS headers on response
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    return res.status(200).json({ ok: true, room, identity });
  } catch (err) {
    return bad(res, 500, err?.message || 'internal error');
  }
};
