const { AccessToken } = require('livekit-server-sdk');

module.exports.config = { runtime: 'nodejs20.x' };

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_WS_URL } = process.env;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_WS_URL) {
      return bad(res, 500, 'Server misconfigured: missing LIVEKIT env vars');
    }

    const { room, identity, metadata } =
      req.method === 'GET' ? req.query : (req.body || {});
    if (!identity) return bad(res, 400, 'Missing identity');
    if (!room) return bad(res, 400, 'Missing room');

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(identity),
      metadata: typeof metadata === 'string' ? metadata : undefined,
      ttl: 60 * 60, // 1 hour
    });

    at.addGrant({
      room: String(room),
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await at.toJwt(); // <-- signed JWT string

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    return res.status(200).json({ token: jwt, url: LIVEKIT_WS_URL });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'internal error' });
  }
};
