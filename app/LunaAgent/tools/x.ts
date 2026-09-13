import { tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { getLunaSecrets } from './aws-secrets.js';

export const searchX = tool({
  name: 'search_x_candidates',

  description:
    'Search recent X posts for professionals discussing a topic. Returns real X profiles plus matching posts as evidence. Use for candidate discovery and professional research.',

  inputSchema: z.object({
    query: z.string().describe(
      'X search query, for example: "AI agents Toronto"'
    ),
    limit: z.number().min(1).max(10).default(5),
  }),

  callback: async ({ query, limit }) => {
    const secrets = await getLunaSecrets();
    const bearerToken = secrets.X_BEARER_TOKEN;

    if (!bearerToken) {
      return {
        success: false,
        error: 'X_BEARER_TOKEN is not configured.',
      };
    }

    const searchQuery = `${query} -is:retweet`;

    const params = new URLSearchParams({
      query: searchQuery,
      max_results: Math.max(10, limit).toString(),
      'tweet.fields': 'author_id,created_at,public_metrics',
      expansions: 'author_id',
      'user.fields':
        'id,name,username,description,location,public_metrics,verified,url',
    });

    const response = await fetch(
      `https://api.x.com/2/tweets/search/recent?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      }
    );

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: await response.text(),
      };
    }

    const data: any = await response.json();

    const tweets = data.data ?? [];
    const users = data.includes?.users ?? [];

    const userMap = new Map(
      users.map((user: any) => [user.id, user])
    );

    const candidateMap = new Map<string, any>();

    for (const tweet of tweets) {
      const user: any = userMap.get(tweet.author_id);

      if (!user) continue;

      if (!candidateMap.has(user.id)) {
        candidateMap.set(user.id, {
          id: user.id,
          name: user.name,
          username: user.username,
          profileUrl: `https://x.com/${user.username}`,
          bio: user.description,
          location: user.location,
          verified: user.verified,
          followers: user.public_metrics?.followers_count,
          following: user.public_metrics?.following_count,
          totalPosts: user.public_metrics?.tweet_count,
          matchingPosts: [],
        });
      }

      const candidate = candidateMap.get(user.id);

      candidate.matchingPosts.push({
        id: tweet.id,
        text: tweet.text,
        createdAt: tweet.created_at,
        likes: tweet.public_metrics?.like_count,
        replies: tweet.public_metrics?.reply_count,
        reposts: tweet.public_metrics?.retweet_count,
        postUrl: `https://x.com/${user.username}/status/${tweet.id}`,
      });
    }

    const candidates = Array.from(candidateMap.values())
      .sort(
        (a: any, b: any) =>
          b.matchingPosts.length - a.matchingPosts.length
      )
      .slice(0, limit);

    return {
      success: true,
      query,
      candidateCount: candidates.length,
      candidates,
    };
  },
});
