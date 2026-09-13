import 'dotenv/config';
import crypto from 'crypto';
import { google } from 'googleapis';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

import { getGoogleAuthClient } from './google-auth.js';
import {
  putPendingAction,
  getPendingAction,
  deletePendingAction,
} from './pending-actions.js';
type PendingCalendarAction = {
  id: string;
  summary: string;
  start: string;
  end: string;
  timeZone: string;
  attendeeEmail?: string;
  description?: string;
  location?: string;
  createdAt: number;
};



export const requestCalendarEventApproval = tool({
  name: 'request_calendar_event_approval',

  description:
    'Prepare a Google Calendar event and request explicit user approval. This does NOT create the event.',

  inputSchema: z.object({
    summary: z.string().min(1),
    start: z.string().describe('ISO 8601 datetime with timezone offset'),
    end: z.string().describe('ISO 8601 datetime with timezone offset'),
    timeZone: z.string().default('America/Toronto'),
    attendeeEmail: z.string().email().optional(),
    description: z.string().optional(),
    location: z.string().optional(),
  }),

  callback: async ({
    summary,
    start,
    end,
    timeZone,
    attendeeEmail,
    description,
    location,
  }) => {
    const id = crypto.randomUUID();

    const action: PendingCalendarAction = {
      id,
      summary,
      start,
      end,
      timeZone,
      attendeeEmail,
      description,
      location,
      createdAt: Date.now(),
    };

    await putPendingAction(
      id,
      'calendar_create',
      action
    );

    return {
      status: 'approval_required',
      approvalId: id,
      event: {
        summary,
        start,
        end,
        timeZone,
        attendeeEmail: attendeeEmail ?? null,
        description: description ?? null,
        location: location ?? null,
      },
      instruction:
        `The calendar event has NOT been created. ` +
        `The user must explicitly reply: APPROVE CALENDAR ${id}`,
    };
  },
});

export async function approveAndCreateCalendarEvent(approvalId: string) {
  const record = await getPendingAction<PendingCalendarAction>(
    approvalId,
    'calendar_create'
  );

  if (!record) {
    throw new Error('Calendar approval request not found or already used.');
  }

  const action = record.payload;

  const ageMinutes = (Date.now() - action.createdAt) / 60000;

  if (ageMinutes > 30) {
    await deletePendingAction(approvalId);
    throw new Error(
      'Calendar approval request expired. Create a new approval request.'
    );
  }

  const auth = await getGoogleAuthClient();

  const calendar = google.calendar({
    version: 'v3',
    auth,
  });

  const result = await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: action.attendeeEmail ? 'all' : 'none',
    requestBody: {
      summary: action.summary,
      description: action.description,
      location: action.location,
      start: {
        dateTime: action.start,
        timeZone: action.timeZone,
      },
      end: {
        dateTime: action.end,
        timeZone: action.timeZone,
      },
      attendees: action.attendeeEmail
        ? [{ email: action.attendeeEmail }]
        : undefined,
    },
  });

  await deletePendingAction(approvalId);

  return {
    created: true,
    eventId: result.data.id ?? null,
    eventLink: result.data.htmlLink ?? null,
    summary: action.summary,
    start: action.start,
    end: action.end,
    attendeeEmail: action.attendeeEmail ?? null,
  };
}
