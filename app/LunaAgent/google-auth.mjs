import 'dotenv/config';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import { google } from 'googleapis';

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = process.env;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error('Missing Google OAuth variables in .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

const state = crypto.randomBytes(24).toString('hex');

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/calendar.events'
  ],
  state,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');

    if (url.pathname !== '/auth/google/callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (url.searchParams.get('state') !== state) {
      res.writeHead(400);
      res.end('Invalid OAuth state');
      return;
    }

    const code = url.searchParams.get('code');

    if (!code) {
      res.writeHead(400);
      res.end('Missing authorization code');
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    fs.writeFileSync(
      '.google-token.json',
      JSON.stringify(tokens, null, 2)
    );

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Google connected successfully. You can close this tab.');

    console.log('\n✅ Google OAuth successful');
    console.log('✅ Token saved to .google-token.json');
    console.log('✅ You can stop this script with Control + C');

  } catch (error) {
    console.error('OAuth error:', error);
    res.writeHead(500);
    res.end('Google authentication failed. Check Terminal.');
  }
});

server.listen(3000, () => {
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nWaiting for Google authorization...');
});
