import 'dotenv/config';
import { google } from 'googleapis';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

import { getGoogleAuthClient } from './google-auth.js';

function headerValue(
  headers: Array<{ name?: string | null; value?: string | null }>,
  name: string
) {
  return (
    headers.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? ''
  );
}

export const searchGmailRelationship = tool({
  name: 'search_gmail_relationship',

  description:
    'Search Gmail for direct email communication with a specific person. Prefer personEmail whenever known. Use this to determine whether the user has actually exchanged emails with someone.',

  inputSchema: z.object({
    personName: z.string().optional(),
    personEmail: z.string().email().optional(),
    maxResults: z.number().int().min(1).max(50).optional().default(30),
  }).refine(
    (data) => Boolean(data.personName || data.personEmail),
    {
      message: 'Provide personName or personEmail',
    }
  ),

  callback: async ({ personName, personEmail, maxResults }) => {
    const auth = await getGoogleAuthClient();

    const gmail = google.gmail({
      version: 'v1',
      auth,
    });

    const profile = await gmail.users.getProfile({
      userId: 'me',
    });

    const myEmail = profile.data.emailAddress?.toLowerCase() ?? '';

    let gmailQuery: string;
    let target: string;

    if (personEmail) {
      target = personEmail.toLowerCase();
      gmailQuery = `{from:${personEmail} to:${personEmail}}`;
    } else {
      const safeName = personName!.replace(/"/g, '');
      target = safeName.toLowerCase();
      gmailQuery = `{from:"${safeName}" to:"${safeName}"}`;
    }

    const searchResponse = await gmail.users.messages.list({
      userId: 'me',
      q: gmailQuery,
      maxResults,
    });

    const refs = searchResponse.data.messages ?? [];

    const relevantMessages = [];

    for (const ref of refs) {
      if (!ref.id) continue;

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: ref.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
      });

      const headers = response.data.payload?.headers ?? [];

      const from = headerValue(headers, 'From');
      const to = headerValue(headers, 'To');
      const cc = headerValue(headers, 'Cc');
      const subject = headerValue(headers, 'Subject');
      const date = headerValue(headers, 'Date');

      const fromLower = from.toLowerCase();
      const recipientsLower = `${to} ${cc}`.toLowerCase();

      const cameFromTarget = fromLower.includes(target);

      const sentToTarget =
        Boolean(myEmail) &&
        fromLower.includes(myEmail) &&
        recipientsLower.includes(target);

      if (!cameFromTarget && !sentToTarget) {
        continue;
      }

      relevantMessages.push({
        id: ref.id,
        threadId: response.data.threadId ?? '',
        from,
        to,
        cc,
        subject,
        date,
        direction: cameFromTarget
          ? 'received_from_person'
          : 'sent_to_person',
        internalDate: response.data.internalDate ?? null,
      });
    }

    relevantMessages.sort((a, b) => {
      return Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0);
    });

    const received = relevantMessages.filter(
      (m) => m.direction === 'received_from_person'
    ).length;

    const sent = relevantMessages.filter(
      (m) => m.direction === 'sent_to_person'
    ).length;

    const twoWay = sent > 0 && received > 0;

    let relationshipSignal = 'none';

    if (twoWay && relevantMessages.length >= 5) {
      relationshipSignal = 'strong';
    } else if (twoWay) {
      relationshipSignal = 'moderate';
    } else if (relevantMessages.length > 0) {
      relationshipSignal = 'weak';
    }

    return {
      personName: personName ?? null,
      personEmail: personEmail ?? null,
      gmailQuery,
      relationshipFound: relevantMessages.length > 0,
      twoWayConversation: twoWay,
      messagesReviewed: relevantMessages.length,
      sentByUser: sent,
      receivedFromPerson: received,
      latestInteraction: relevantMessages[0]?.date ?? null,
      relationshipSignal,
      messages: relevantMessages.slice(0, 10),
      note:
        personEmail
          ? 'Relationship evidence was searched using the exact email address.'
          : 'This was a name-based Gmail search. An exact email address provides stronger evidence.',
    };
  },
});
