// /api/analyticsTop.js
module.exports.config = { runtime: 'nodejs20.x' };
const fetch = (...a) => import('node-fetch').then(({default: f}) => f(...a));
const { AccessToken } = require('livekit-server-sdk');

const API = 'https://cloud-api.livekit.io/api';

function makeAnalyticsToken() {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { ttl: 3600 });
  at.addGrant({ roomList: true });
  return at.toJwt();
}

module.exports = async (req, res) => {
  try {
    const { projectId, room, start, end } = req.query;
    if (!projectId || !room || !start || !end) {
      return res.status(400).json({ error: 'projectId, room, start, end required' });
    }

    const token = await makeAnalyticsToken();
    const h = { Authorization: `Bearer ${token}` };

    // 1) list sessions in the window
    const listUrl = `${API}/project/${projectId}/sessions?start=${start}&end=${end}&page=0&limit=100`;
    const sessions = await (await fetch(listUrl, { headers: h })).json();

    // 2) pull just sessions for this room
    const targets = (sessions.sessions || []).filter(s => s.roomName === room);

    const totals = {}; // identity -> seconds
    for (const s of targets) {
      const detailUrl = `${API}/project/${projectId}/sessions/${s.sessionId}`;
      const det = await (await fetch(detailUrl, { headers: h })).json();

      for (const p of (det.participants || [])) {
        let secs = 0;
        if (Array.isArray(p.sessions)) {
          for (const sub of p.sessions) {
            const j = sub.joinedAt ? new Date(sub.joinedAt).getTime() : 0;
            const l = sub.leftAt   ? new Date(sub.leftAt).getTime()   : j;
            secs += Math.max(0, Math.round((l - j) / 1000));
          }
        } else {
          const j = p.joinedAt ? new Date(p.joinedAt).getTime() : 0;
          const l = p.leftAt   ? new Date(p.leftAt).getTime()   : j;
          secs += Math.max(0, Math.round((l - j) / 1000));
        }
        totals[p.participantIdentity] = (totals[p.participantIdentity] || 0) + secs;
      }
    }

    const leaderboard = Object.entries(totals)
      .map(([identity, seconds]) => ({ identity, seconds }))
      .sort((a, b) => b.seconds - a.seconds);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ room, start, end, leaderboard });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'internal error' });
  }
};
