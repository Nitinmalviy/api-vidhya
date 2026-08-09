import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env } from '../config/env';
import { ServiceUnavailableError } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * LiveKit access for Live-OPD video calls.
 *
 * Tokens are JWTs we sign locally — no round-trip to LiveKit — so minting one is
 * cheap enough to do on every join. Each token is scoped to a single room and
 * carries the participant's real identity, which is what stops a patient from
 * wandering into someone else's consultation.
 */

export const isLiveKitConfigured = (): boolean =>
  !!env.LIVEKIT_URL && !!env.LIVEKIT_API_KEY && !!env.LIVEKIT_API_SECRET;

/** Tokens outlive a long consultation but not the day. */
const TOKEN_TTL = '4h';

export type LiveKitGrant = {
  /** Room to join — the consultation's `roomName`. */
  room: string;
  /** Stable participant id, e.g. `patient:<id>` / `doctor:<id>`. */
  identity: string;
  /** Display name shown in the call. */
  name: string;
  /** Extra data the other side can read (role, etc.). */
  metadata?: Record<string, unknown>;
};

export type LiveKitCredentials = {
  url: string;
  token: string;
  room: string;
  identity: string;
  expiresIn: string;
};

export async function createCallToken(grant: LiveKitGrant): Promise<LiveKitCredentials> {
  if (!isLiveKitConfigured()) {
    throw new ServiceUnavailableError(
      'Video calling is not configured yet — please contact support'
    );
  }

  const at = new AccessToken(env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!, {
    identity: grant.identity,
    name: grant.name,
    ttl: TOKEN_TTL,
    ...(grant.metadata ? { metadata: JSON.stringify(grant.metadata) } : {}),
  });

  at.addGrant({
    room: grant.room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    // Data messages carry the in-call chat and "doctor ended the call" signals.
    canPublishData: true,
    // A 1:1 consultation never needs anyone creating or listing other rooms.
    roomCreate: false,
    roomList: false,
  });

  return {
    url: env.LIVEKIT_URL!,
    token: await at.toJwt(),
    room: grant.room,
    identity: grant.identity,
    expiresIn: TOKEN_TTL,
  };
}

let roomClient: RoomServiceClient | null = null;

function getRoomClient(): RoomServiceClient | null {
  if (!isLiveKitConfigured()) return null;
  if (!roomClient) {
    // The REST host is the ws URL over https.
    const host = env.LIVEKIT_URL!.replace(/^ws/, 'http');
    roomClient = new RoomServiceClient(host, env.LIVEKIT_API_KEY!, env.LIVEKIT_API_SECRET!);
  }
  return roomClient;
}

/**
 * Force a room shut when a consultation ends, so a stale tab can't keep
 * streaming (and billing) after the doctor has moved on. Best-effort: a failure
 * here must never break ending the consultation.
 */
export async function closeRoom(roomName: string): Promise<void> {
  const client = getRoomClient();
  if (!client) return;
  try {
    await client.deleteRoom(roomName);
  } catch (err) {
    logger.warn({ err, roomName }, 'Could not delete LiveKit room');
  }
}
