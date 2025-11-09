// functions/src/getUniversalPreviewToken.ts
// deps: livekit-server-sdk ^2, firebase-functions ^5
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { AccessToken, VideoGrant } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

// OPTIONAL: set your max TTL (seconds). Keep sane even if "long-lived".
const MAX_TTL = 6 * 60 * 60; // 6 hours

export const getUniversalPreviewToken = onRequest({ cors: true }, async (req, res) => {
  try {
    // (Optional) verify Firebase Auth here if you want to restrict who can get this
    // const idToken = req.headers.authorization?.replace('Bearer ', '');

    const { identity, ttl } = (req.method === 'POST' ? req.body : req.query) as {
      identity?: string;
      ttl?: string | number;
    };

    const grant: VideoGrant = {
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      // no room -> universal
    };

    const requestedTtl = Math.min(
      Number(ttl ?? MAX_TTL),
      MAX_TTL
    );

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: identity ?? `univ-${Math.random().toString(36).slice(2, 10)}`,
      ttl: requestedTtl,
      metadata: JSON.stringify({ preview: true, universal: true }),
    });
    at.addGrant(grant);

    const token = await at.toJwt();
    res.json({ token, ttl: requestedTtl });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ error: 'failed_to_issue_token' });
  }
});
