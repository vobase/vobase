import type { VobaseDb } from '@vobase/core';
import { sql } from 'drizzle-orm';

import { channelInstanceTeams } from '../schema';

/**
 * Get channel instance IDs accessible to a user based on team membership.
 *
 * Queries better-auth's `auth.team_member` table for the user's teams,
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
  const teamIds = await db.execute<{ team_id: string }>(sql`
    SELECT tm."teamId" AS team_id
    FROM auth.team_member tm
    WHERE tm."userId" = ${userId}
  `);

  const rows = Array.isArray(teamIds) ? teamIds : (teamIds.rows ?? []);
  if (rows.length === 0) return null;

  const userTeamIds = rows.map((r) => r.team_id);

  // Get channel instance IDs mapped to user's teams
  const results = await db
    .selectDistinct({
      channelInstanceId: channelInstanceTeams.channelInstanceId,
    })
    .from(channelInstanceTeams)
    .where(sql`${channelInstanceTeams.teamId} IN ${userTeamIds}`);

  return results.map((r) => r.channelInstanceId);
}
