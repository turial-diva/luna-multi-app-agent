import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  })
);

const PROVIDER_TOKEN_TABLE =
  process.env.PROVIDER_TOKEN_TABLE ??
  'LunaProviderTokens';

async function getSlackToken(userId: string) {
  const result = await dynamo.send(
    new GetCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Key: {
        userId,
        provider: 'slack',
      },
    })
  );

  const token = result.Item?.accessToken;

  if (!token) {
    throw new Error(
      'Slack is not connected for this user.'
    );
  }

  return {
    accessToken: token as string,
    teamName:
      (result.Item?.slackTeamName as string | undefined) ??
      null,
    teamId:
      (result.Item?.slackTeamId as string | undefined) ??
      null,
  };
}

export function createSearchSlackPeople(
  userId: string
) {
  return tool({
    name: 'search_slack_people',

    description:
      'Search people in the authenticated user’s connected Slack workspace. Use this to discover or verify professional connections, teammates, founders, developers, operators, and other people in Slack. Slack workspace membership is evidence that a person shares the workspace, but does not by itself prove a close relationship or warm introduction.',

    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Name, email, title, role, company, skill, or other text to search for in Slack member profiles.'
        ),

      limit: z
        .number()
        .min(1)
        .max(10)
        .default(5),
    }),

    callback: async ({ query, limit }) => {
      const { accessToken, teamName, teamId } =
        await getSlackToken(userId);

      const members: any[] = [];
      let cursor = '';

      // Fetch up to 2 pages to keep the tool fast.
      for (let page = 0; page < 2; page++) {
        const params = new URLSearchParams({
          limit: '200',
        });

        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await fetch(
          `https://slack.com/api/users.list?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const data: any = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(
            `Slack users.list failed: ${
              data?.error ?? response.statusText
            }`
          );
        }

        members.push(...(data.members ?? []));

        cursor =
          data.response_metadata?.next_cursor ?? '';

        if (!cursor) break;
      }

      const normalizedQuery =
        query.trim().toLowerCase();

      const candidates = members
        .filter(
          (member) =>
            !member.deleted &&
            !member.is_bot &&
            member.id !== 'USLACKBOT'
        )
        .map((member) => {
          const profile = member.profile ?? {};

          const searchable = [
            member.name,
            profile.real_name,
            profile.display_name,
            profile.email,
            profile.title,
            profile.status_text,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return {
            member,
            searchable,
          };
        })
        .filter(({ searchable }) =>
          normalizedQuery
            ? searchable.includes(normalizedQuery)
            : true
        )
        .slice(0, limit)
        .map(({ member }) => {
          const profile = member.profile ?? {};

          return {
            slackUserId: member.id,
            username: member.name ?? null,
            realName:
              profile.real_name ??
              member.real_name ??
              null,
            displayName:
              profile.display_name ?? null,
            email: profile.email ?? null,
            title: profile.title ?? null,
            statusText:
              profile.status_text ?? null,
            timezone:
              member.tz_label ??
              member.tz ??
              null,
          };
        });

      return {
        source: 'Slack',
        workspace: {
          id: teamId,
          name: teamName,
        },
        query,
        count: candidates.length,
        candidates,
        relationshipNote:
          'Being in the same Slack workspace does not by itself prove a close relationship or warm introduction path.',
      };
    },
  });
}
