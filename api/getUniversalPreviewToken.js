// /api/getUniversalPreviewToken.js
const { AccessToken } = require('livekit-server-sdk');

module.exports.config = { runtime: 'nodejs20.x' };

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}

module.exports = async (req, res) => {
  try {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(204).end();
    }

    // Enforce POST for safety (JWTs shouldn't go in query strings)
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return bad(res, 405, 'Method Not Allowed');
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WS_URL } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
      return bad(res, 500, 'Server misconfigured: missing LIVEKIT env vars');
    }

    // Body: optional identity + ttl; do NOT require room (universal)
    const body = (req.body || {});
    const identity = body.identity || `preview-${Math.random().toString(36).slice(2, 10)}`;
    const ttl = Math.min(Number(body.ttl ?? 21600), 21600); // cap at 6h

    // Universal, subscribe-only grant (no 'room' field)
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(identity),
      ttl,
      metadata: JSON.stringify({ preview: true, universal: true }),
    });

    at.addGrant({
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      // no `room` => works for any room on this LK instance
    });

    const jwt = await at.toJwt();

    // CORS / cache headers
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return res.status(200).json({ token: jwt, url: LIVEKIT_WS_URL, ttl });
  } catch (err) {
    return bad(res, 500, err?.message || 'internal error');
  }
};
