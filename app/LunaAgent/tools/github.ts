import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

export const searchGitHub = tool({
  name: 'search_github',

  description:
    'Search GitHub for technical professionals, developers, engineers, founders, and potential technical cofounders. Use this tool when the user wants to discover technical people based on skills, interests, technologies, or location.',

  inputSchema: z.object({
    query: z.string().describe(
      'GitHub user search query, for example: "AI agents location:Toronto"'
    ),
    limit: z.number().min(1).max(5).default(5),
  }),

  callback: async ({ query, limit }) => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Luna-Agent',
    };

    // Optional token gives Luna a higher GitHub API rate limit.
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const searchUrl =
      `https://api.github.com/search/users?q=${encodeURIComponent(query)}` +
      `&per_page=${limit}`;

    const searchResponse = await fetch(searchUrl, { headers });

    if (!searchResponse.ok) {
      throw new Error(
        `GitHub search failed: ${searchResponse.status} ${searchResponse.statusText}`
      );
    }

    const searchData: any = await searchResponse.json();

    const candidates = await Promise.all(
      (searchData.items || []).slice(0, limit).map(async (user: any) => {
        const profileResponse = await fetch(user.url, { headers });

        if (!profileResponse.ok) {
          return {
            username: user.login,
            profileUrl: user.html_url,
          };
        }

        const profile: any = await profileResponse.json();

        return {
          username: profile.login,
          name: profile.name,
          bio: profile.bio,
          location: profile.location,
          company: profile.company,
          blog: profile.blog,
          profileUrl: profile.html_url,
          publicRepos: profile.public_repos,
          followers: profile.followers,
        };
      })
    );

    return {
      query,
      count: candidates.length,
      candidates,
    };
  },
});
