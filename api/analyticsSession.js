// /api/analyticsSession.js
module.exports.config = { runtime: 'nodejs20.x' };

const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const { AccessToken } = require('livekit-server-sdk');

const API = 'https://cloud-api.livekit.io/api';

// Create a short-lived Analytics token (server-side)
function makeAnalyticsToken() {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { ttl: 3600 } // 1 hour
  );
  // Needed to call Analytics API
  at.addGrant({ roomList: true });
  return at.toJwt();
}

module.exports = async (req, res) => {
  try {
    const projectId = (req.query.projectId || '').toString().trim();
    const sessionId = (req.query.sessionId || '').toString().trim();
    if (!projectId || !sessionId) {
      return res
        .status(400)
        .json({ error: 'projectId and sessionId are required' });
    }

    const token = await makeAnalyticsToken();
    const url = `${API}/project/${projectId}/sessions/${sessionId}`;

    const r = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: text || 'analytics error' });
    }

    const data = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'internal error' });
  }
};
