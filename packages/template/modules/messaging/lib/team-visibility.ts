import type { VobaseDb } from '@vobase/core';
import { authTeamMember } from '@vobase/core';
import { eq, inArray } from 'drizzle-orm';

import { channelInstanceTeams } from '../schema';

/**
 * Get channel instance IDs accessible to a user based on team membership.
 *
 * Queries better-auth's team_member table for the user's teams,
 * then joins with `channelInstanceTeams` to find accessible channel instances.
 *
 * Returns `null` if the user has no team memberships (meaning no filtering —
 * all channel instances are accessible for backwards compat).
 */
export async function getAccessibleChannelInstanceIds(
  db: VobaseDb,
  userId: string,
): Promise<string[] | null> {
  // Check if user has any team memberships via better-auth tables
  const teamRows = await db
    .select({ teamId: authTeamMember.teamId })
    .from(authTeamMember)
    .where(eq(authTeamMember.userId, userId));

  if (teamRows.length === 0) return null;

  const userTeamIds = teamRows.map((r) => r.teamId);

  // Get channel instance IDs mapped to user's teams
  const results = await db
    .selectDistinct({
      channelInstanceId: channelInstanceTeams.channelInstanceId,
    })
    .from(channelInstanceTeams)
    .where(inArray(channelInstanceTeams.teamId, userTeamIds));

  return results.map((r) => r.channelInstanceId);
}
