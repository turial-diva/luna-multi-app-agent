import 'dotenv/config';
import { google } from 'googleapis';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

import { getGoogleAuthClient } from './google-auth.js';

export const searchGoogleContacts = tool({
  name: 'search_google_contacts',
  description:
    'Search the connected Google account contacts for people matching a name, company, email, role, or other text. Use this to find whether the user already knows a candidate or has a possible relationship path.',
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('Person name, company, email, role, or keyword to search for'),
  }),

  callback: async ({ query }) => {
    const auth = await getGoogleAuthClient();

    const people = google.people({
      version: 'v1',
      auth,
    });

    const response = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields:
        'names,emailAddresses,phoneNumbers,organizations,biographies,urls',
    });

    const connections = response.data.connections ?? [];
    const q = query.toLowerCase();

    const matches = connections
      .map((person) => {
        const name = person.names?.[0]?.displayName ?? '';
        const emails =
          person.emailAddresses?.map((item) => item.value ?? '') ?? [];
        const phones =
          person.phoneNumbers?.map((item) => item.value ?? '') ?? [];
        const organizations =
          person.organizations?.map((org) => ({
            name: org.name ?? '',
            title: org.title ?? '',
            department: org.department ?? '',
          })) ?? [];
        const urls =
          person.urls?.map((item) => item.value ?? '') ?? [];

        const searchable = JSON.stringify({
          name,
          emails,
          phones,
          organizations,
          urls,
        }).toLowerCase();

        return {
          matches: searchable.includes(q),
          contact: {
            name,
            emails,
            phones,
            organizations,
            urls,
          },
        };
      })
      .filter((item) => item.matches)
      .map((item) => item.contact)
      .slice(0, 20);

    return {
      query,
      matchCount: matches.length,
      contacts: matches,
    };
  },
});

export const findGoogleWarmPath = tool({
  name: 'find_google_warm_path',
  description:
    'Find possible warm introduction paths through the user Google contacts. Use this to check whether the candidate is already a direct contact, or whether the user knows people at the same company or email domain. Same-company or domain matches are possible paths, not proof of a close relationship.',
  inputSchema: z.object({
    candidateName: z.string().min(1),
    company: z.string().optional(),
    emailDomain: z.string().optional(),
  }),

  callback: async ({ candidateName, company, emailDomain }) => {
    const auth = await getGoogleAuthClient();

    const people = google.people({
      version: 'v1',
      auth,
    });

    const response = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields:
        'names,emailAddresses,phoneNumbers,organizations,urls',
    });

    const connections = response.data.connections ?? [];

    const normalizedCandidate = candidateName.toLowerCase();
    const normalizedCompany = company?.toLowerCase();
    const normalizedDomain = emailDomain?.toLowerCase().replace(/^@/, '');

    const directMatches = [];
    const companyMatches = [];
    const domainMatches = [];

    for (const person of connections) {
      const name = person.names?.[0]?.displayName ?? '';
      const emails =
        person.emailAddresses?.map((item) => item.value ?? '') ?? [];
      const organizations =
        person.organizations?.map((org) => ({
          name: org.name ?? '',
          title: org.title ?? '',
        })) ?? [];

      const contact = {
        name,
        emails,
        organizations,
      };

      if (name.toLowerCase().includes(normalizedCandidate)) {
        directMatches.push(contact);
      }

      if (
        normalizedCompany &&
        organizations.some((org) =>
          org.name.toLowerCase().includes(normalizedCompany)
        )
      ) {
        companyMatches.push(contact);
      }

      if (
        normalizedDomain &&
        emails.some((email) =>
          email.toLowerCase().endsWith(`@${normalizedDomain}`)
        )
      ) {
        domainMatches.push(contact);
      }
    }

    return {
      candidateName,
      directContactFound: directMatches.length > 0,
      directMatches: directMatches.slice(0, 10),
      possibleCompanyPaths: companyMatches.slice(0, 10),
      possibleDomainPaths: domainMatches.slice(0, 10),
      interpretation: {
        directContact:
          'A direct contact match is a stronger relationship signal.',
        companyOrDomain:
          'Same-company or same-domain matches are possible introduction paths only. They do not prove the user has a close relationship with the candidate.',
      },
    };
  },
});
