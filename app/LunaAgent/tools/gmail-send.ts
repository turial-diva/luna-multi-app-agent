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
type PendingGmailAction = {
  id: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  createdAt: number;
};



function encodeMessage(message: string) {
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendGmailMessage(action: PendingGmailAction) {
  const auth = await getGoogleAuthClient();

  const gmail = google.gmail({
    version: 'v1',
    auth,
  });

  const headers = [
    `To: ${action.to}`,
    ...(action.cc ? [`Cc: ${action.cc}`] : []),
    `Subject: ${action.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];

  const email = `${headers.join('\r\n')}\r\n\r\n${action.body}`;

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodeMessage(email),
    },
  });

  return {
    sent: true,
    to: action.to,
    cc: action.cc ?? null,
    subject: action.subject,
    messageId: result.data.id ?? null,
    threadId: result.data.threadId ?? null,
  };
}

export const requestGmailSendApproval = tool({
  name: 'request_gmail_send_approval',

  description:
    'Prepare an email for sending and request explicit user approval. This does NOT send the email. Always use this before an email can be sent.',

  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    body: z.string().min(1),
    cc: z.string().email().optional(),
  }),

  callback: async ({ to, subject, body, cc }) => {
    const id = crypto.randomUUID();

    const action: PendingGmailAction = {
      id,
      to,
      subject,
      body,
      cc,
      createdAt: Date.now(),
    };

    await putPendingAction(
      id,
      'gmail_send',
      action
    );

    return {
      status: 'approval_required',
      approvalId: id,
      email: {
        to,
        cc: cc ?? null,
        subject,
        body,
      },
      instruction: `The email has NOT been sent. The user must explicitly reply: APPROVE ${id}`,
    };
  },
});

export async function approveAndSendGmail(approvalId: string) {
  const record = await getPendingAction<PendingGmailAction>(
    approvalId,
    'gmail_send'
  );

  if (!record) {
    throw new Error('Approval request not found or already used.');
  }

  const action = record.payload;

  const ageMinutes = (Date.now() - action.createdAt) / 60000;

  if (ageMinutes > 30) {
    await deletePendingAction(approvalId);
    throw new Error('Approval request expired. Create a new email approval request.');
  }

  const result = await sendGmailMessage(action);

  await deletePendingAction(approvalId);

  return result;
}
