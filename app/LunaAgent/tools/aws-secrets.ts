import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

type LunaSecrets = {
  X_BEARER_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
};

let cachedSecrets: LunaSecrets | null = null;

export async function getLunaSecrets(): Promise<LunaSecrets> {
  if (cachedSecrets) {
    return cachedSecrets;
  }

  // Local development: use environment variables if available.
  if (
    process.env.X_BEARER_TOKEN ||
    process.env.GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    cachedSecrets = {
      X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    };

    return cachedSecrets;
  }

  // AWS deployment: load from Secrets Manager.
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });

  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: 'luna/agent-credentials',
    })
  );

  if (!response.SecretString) {
    throw new Error('Luna secret does not contain SecretString.');
  }

  const parsedSecrets = JSON.parse(response.SecretString) as LunaSecrets;

  cachedSecrets = parsedSecrets;

  return parsedSecrets;
}
