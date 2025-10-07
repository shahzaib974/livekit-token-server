// api/listParticipants.js
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

    if (req.method !== 'GET' && req.method !== 'POST') {
      return bad(res, 405, 'GET or POST only');
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WS_URL } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
      return bad(res, 500, 'Server misconfigured: missing LIVEKIT env vars');
    }

    // room can come from query (GET) or body (POST)
    const src = req.method === 'GET' ? req.query : (req.body || {});
    const room = String(src.room || '').trim();
    if (!room) return bad(res, 400, 'Missing room');

    const svc = new RoomServiceClient(
      LIVEKIT_WS_URL,
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET
    );

    const participants = await svc.listParticipants(room); // array of participants

    // CORS headers
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // You’ll typically use `identity` from each item to kick with removeParticipant
    return res.status(200).json({
      room,
      count: Array.isArray(participants) ? participants.length : 0,
      participants,
    });
  } catch (err) {
    return bad(res, 500, err?.message || 'internal error');
  }
};
