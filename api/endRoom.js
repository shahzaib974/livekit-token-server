// api/endRoom.js
import { RoomServiceClient } from 'livekit-server-sdk';

const svc = new RoomServiceClient(
  process.env.LIVEKIT_WS_URL,      // e.g. wss://xxxx.livekit.cloud
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

export default async function handler(req, res) {
  // CORS (optional)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const room = String(body.room || '').trim();
    if (!room) return res.status(400).json({ error: 'missing room' });

    await svc.deleteRoom(room); // disconnects everyone immediately

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true, room });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'internal_error' });
  }
}
