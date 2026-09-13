import 'dotenv/config';
import { google } from 'googleapis';
import { tool } from '@strands-agents/sdk';
import { z } from 'zod';

import { getGoogleAuthClient } from './google-auth.js';

export const getCalendarAvailability = tool({
  name: 'get_calendar_availability',

  description:
    'Check the connected Google Calendar for busy periods within a specific time range. Use this before proposing meeting times.',

  inputSchema: z.object({
    start: z
      .string()
      .describe('Start of search range in ISO 8601 format'),
    end: z
      .string()
      .describe('End of search range in ISO 8601 format'),
    timeZone: z
      .string()
      .optional()
      .default('America/Toronto'),
  }),

  callback: async ({ start, end, timeZone }) => {
    const auth = await getGoogleAuthClient();

    const calendar = google.calendar({
      version: 'v3',
      auth,
    });

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: start,
        timeMax: end,
        timeZone,
        items: [
          {
            id: 'primary',
          },
        ],
      },
    });

    const busy =
      response.data.calendars?.primary?.busy?.map((period) => ({
        start: period.start ?? null,
        end: period.end ?? null,
      })) ?? [];

    return {
      calendar: 'primary',
      range: {
        start,
        end,
        timeZone,
      },
      busyPeriods: busy,
      busyCount: busy.length,
      note:
        busy.length === 0
          ? 'No busy periods were found in this range.'
          : 'These are busy periods only. Times outside these periods may be available.',
    };
  },
});
