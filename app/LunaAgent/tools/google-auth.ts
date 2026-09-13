import 'dotenv/config';
import fs from 'fs';
import { google } from 'googleapis';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getLunaSecrets } from './aws-secrets.js';

const TOKEN_PATH = '.google-token.json';
const GOOGLE_TOKEN_SECRET = 'luna/google-oauth-token';

type GoogleTokens = {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
};

async function getGoogleTokens(): Promise<{
  tokens: GoogleTokens;
  source: 'local' | 'aws';
}> {
  // Local development
  if (fs.existsSync(TOKEN_PATH)) {
    return {
      tokens: JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')),
      source: 'local',
    };
  }

  // AgentCore / AWS
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: GOOGLE_TOKEN_SECRET,
    })
  );

  if (!response.SecretString) {
    throw new Error('Google OAuth token secret is empty.');
  }

  return {
    tokens: JSON.parse(response.SecretString),
    source: 'aws',
  };
}

export async function getGoogleAuthClient() {
  const secrets = await getLunaSecrets();

  const clientId = secrets.GOOGLE_CLIENT_ID;
  const clientSecret = secrets.GOOGLE_CLIENT_SECRET;
  const redirectUri = secrets.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth credentials are not configured.');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  const { tokens, source } = await getGoogleTokens();

  oauth2Client.setCredentials(tokens);

  // Keep local development token refreshed on disk.
  // In AWS the refresh token stored in Secrets Manager remains sufficient
  // for OAuth2Client to refresh access tokens during runtime.
  if (source === 'local') {
    oauth2Client.on('tokens', (newTokens) => {
      const currentTokens = fs.existsSync(TOKEN_PATH)
        ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
        : {};

      fs.writeFileSync(
        TOKEN_PATH,
        JSON.stringify(
          {
            ...currentTokens,
            ...newTokens,
          },
          null,
          2
        )
      );
    });
  }

  return oauth2Client;
}
