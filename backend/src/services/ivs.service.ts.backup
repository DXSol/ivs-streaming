import { IvsClient, GetChannelCommand, GetStreamCommand } from '@aws-sdk/client-ivs';
import { env } from '../config/env';

// Explicitly pass credentials from .env to avoid using ~/.aws/credentials default profile
const ivsClient = new IvsClient({
  region: env.aws.region,
  credentials: env.aws.accessKeyId && env.aws.secretAccessKey
    ? {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      }
    : undefined,
});

const playbackUrlCache = new Map<string, { url: string; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the playback URL for an IVS channel by its ARN.
 * Uses a short-lived cache to avoid repeated AWS API calls.
 */
export async function getPlaybackUrlFromArn(channelArn: string): Promise<string> {
  const cached = playbackUrlCache.get(channelArn);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.url;
  }

  try {
    const command = new GetChannelCommand({ arn: channelArn });
    const response = await ivsClient.send(command);

    const playbackUrl = response.channel?.playbackUrl;
    if (!playbackUrl) {
      console.error(`[IVS] No playback URL in response for channel: ${channelArn}`);
      throw new Error(`No playback URL found for channel: ${channelArn}`);
    }

    playbackUrlCache.set(channelArn, { url: playbackUrl, cachedAt: Date.now() });
    return playbackUrl;
  } catch (error: any) {
    console.error(`[IVS] Failed to get channel ${channelArn}:`, error.message || error);
    throw error;
  }
}

/**
 * Clear the playback URL cache (useful for testing or after channel updates).
 */
export function clearPlaybackUrlCache(): void {
  playbackUrlCache.clear();
}

/**
 * Check if a stream is currently live on the given channel.
 * Returns the stream state, viewer count, and other info from IVS.
 */
export async function getStreamStatus(channelArn: string): Promise<{ isLive: boolean; state: string; viewerCount: number }> {
  try {
    const command = new GetStreamCommand({ channelArn });
    const response = await ivsClient.send(command);

    const state = response.stream?.state || 'OFFLINE';
    const isLive = state === 'LIVE';
    const viewerCount = response.stream?.viewerCount || 0;

    return { isLive, state, viewerCount };
  } catch (error: any) {
    // ChannelNotBroadcasting means stream is offline (not an error)
    if (error.name === 'ChannelNotBroadcasting' || error.message?.includes('not broadcasting')) {
      return { isLive: false, state: 'OFFLINE', viewerCount: 0 };
    }
    console.error(`[IVS] Failed to get stream status for ${channelArn}:`, error.message || error);
    return { isLive: false, state: 'ERROR', viewerCount: 0 };
  }
}
