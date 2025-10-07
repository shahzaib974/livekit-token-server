// api/endRoom.js
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

    // Accept JSON from GET query or POST body (like your token endpoint)
    const src = req.method === 'GET' ? req.query : (req.body || {});
    const room = String(src.room || '').trim();
    if (!room) return bad(res, 400, 'Missing room');

    const svc = new RoomServiceClient(
      LIVEKIT_WS_URL,
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );

    // End the room for everyone
    await svc.deleteRoom(room);

    // CORS headers on response
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    return res.status(200).json({ ok: true, room });
  } catch (err) {
    return bad(res, 500, err?.message || 'internal error');
  }
};
