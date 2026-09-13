import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

import {
  LambdaClient,
  InvokeCommand,
} from '@aws-sdk/client-lambda';

import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'crypto';

const REGION = 'us-east-1';

const client = new BedrockAgentCoreClient({
  region: REGION,
});

const secretsClient = new SecretsManagerClient({
  region: REGION,
});

const lambdaClient = new LambdaClient({
  region: REGION,
});

const dynamoClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: REGION,
  }),
  {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  }
);

const AGENT_RUNTIME_ARN =
  'arn:aws:bedrock-agentcore:us-east-1:496832097591:runtime/Luna_LunaAgent-wvB0WIFW6I';

const PROVIDER_TOKEN_TABLE = 'LunaProviderTokens';
const AGENT_JOBS_TABLE = 'LunaAgentJobs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET;

const GOOGLE_REDIRECT_URI =
  'https://6e0c987ln3.execute-api.us-east-1.amazonaws.com/google/callback';

const GITHUB_REDIRECT_URI =
  'https://6e0c987ln3.execute-api.us-east-1.amazonaws.com/github/callback';

const X_REDIRECT_URI =
  'https://6e0c987ln3.execute-api.us-east-1.amazonaws.com/x/callback';

const SLACK_REDIRECT_URI =
  'https://6e0c987ln3.execute-api.us-east-1.amazonaws.com/slack/callback';


const LUNA_CONNECT_URL =
  'https://lunaagent.nc-connect.app/onboarding/connect';

if (!SUPABASE_URL) {
  throw new Error('SUPABASE_URL environment variable is required');
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_ANON_KEY environment variable is required');
}

if (!OAUTH_STATE_SECRET) {
  throw new Error('OAUTH_STATE_SECRET environment variable is required');
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

let googleCredentialsCache = null;
let slackCredentialsCache = null;
let githubCredentialsCache = null;
let xCredentialsCache = null;

function unauthorized(message = 'Unauthorized') {
  return {
    statusCode: 401,
    headers,
    body: JSON.stringify({
      success: false,
      error: message,
    }),
  };
}

function getRouteKey(event) {
  return event?.routeKey ?? '';
}

async function authenticate(event) {
  const authorization =
    event?.headers?.authorization ??
    event?.headers?.Authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw new Error('Missing bearer token');
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    throw new Error('Missing bearer token');
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      'Supabase user validation failed:',
      response.status,
      errorText
    );

    throw new Error('Supabase rejected authentication token');
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error('Supabase response did not contain a user id');
  }

  return {
    userId: user.id,
    email:
      typeof user.email === 'string'
        ? user.email
        : null,
  };
}

async function getGoogleCredentials() {
  if (googleCredentialsCache) {
    return googleCredentialsCache;
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: 'luna/agent-credentials',
    })
  );

  if (!result.SecretString) {
    throw new Error('Google credential secret is empty');
  }

  const secret = JSON.parse(result.SecretString);

  if (!secret.GOOGLE_CLIENT_ID) {
    throw new Error(
      'GOOGLE_CLIENT_ID missing from luna/agent-credentials'
    );
  }

  if (!secret.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'GOOGLE_CLIENT_SECRET missing from luna/agent-credentials'
    );
  }

  googleCredentialsCache = {
    clientId: secret.GOOGLE_CLIENT_ID,
    clientSecret: secret.GOOGLE_CLIENT_SECRET,
  };

  return googleCredentialsCache;
}


async function getGitHubCredentials() {
  if (githubCredentialsCache) {
    return githubCredentialsCache;
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: 'luna/agent-credentials',
    })
  );

  if (!result.SecretString) {
    throw new Error('GitHub credential secret is empty');
  }

  const secret = JSON.parse(result.SecretString);

  if (!secret.GITHUB_CLIENT_ID) {
    throw new Error('GITHUB_CLIENT_ID missing from luna/agent-credentials');
  }

  if (!secret.GITHUB_CLIENT_SECRET) {
    throw new Error('GITHUB_CLIENT_SECRET missing from luna/agent-credentials');
  }

  githubCredentialsCache = {
    clientId: secret.GITHUB_CLIENT_ID,
    clientSecret: secret.GITHUB_CLIENT_SECRET,
  };

  return githubCredentialsCache;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signStatePayload(encodedPayload) {
  return createHmac('sha256', OAUTH_STATE_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function createOAuthState(userId) {
  const payload = {
    userId,
    exp: Date.now() + 10 * 60 * 1000,
    nonce: randomUUID(),
  };

  const encodedPayload = base64UrlEncode(
    JSON.stringify(payload)
  );

  const signature = signStatePayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function verifyOAuthState(state) {
  if (!state || typeof state !== 'string') {
    throw new Error('Missing OAuth state');
  }

  const parts = state.split('.');

  if (parts.length !== 2) {
    throw new Error('Invalid OAuth state format');
  }

  const [encodedPayload, suppliedSignature] = parts;

  const expectedSignature =
    signStatePayload(encodedPayload);

  const suppliedBuffer =
    Buffer.from(suppliedSignature);

  const expectedBuffer =
    Buffer.from(expectedSignature);

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid OAuth state signature');
  }

  const payload = JSON.parse(
    base64UrlDecode(encodedPayload)
  );

  if (!payload.userId) {
    throw new Error('OAuth state missing user id');
  }

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error('OAuth state expired');
  }

  return payload;
}


async function handleGitHubConnect(event) {
  let auth;

  try {
    auth = await authenticate(event);
  } catch (error) {
    console.error('GitHub connect authentication failed:', error);
    return unauthorized('Invalid or expired authentication token');
  }

  const { clientId } = await getGitHubCredentials();
  const state = createOAuthState(auth.userId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: 'read:user user:email',
    state,
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      authorizationUrl:
        `https://github.com/login/oauth/authorize?${params.toString()}`,
    }),
  };
}

async function exchangeGitHubCode(code) {
  const { clientId, clientSecret } =
    await getGitHubCredentials();

  const response = await fetch(
    'https://github.com/login/oauth/access_token',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type':
          'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    }
  );

  const tokenData = await response.json();

  if (!response.ok || tokenData.error || !tokenData.access_token) {
    console.error('GitHub token exchange failed:', tokenData);
    throw new Error('GitHub token exchange failed');
  }

  return tokenData;
}

async function getGitHubUser(accessToken) {
  const response = await fetch(
    'https://api.github.com/user',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Luna-Agent',
      },
    }
  );

  if (!response.ok) {
    throw new Error('GitHub user lookup failed');
  }

  return await response.json();
}

async function saveGitHubTokens(
  userId,
  tokenData,
  githubUser
) {
  const existingResult = await dynamoClient.send(
    new GetCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Key: {
        userId,
        provider: 'github',
      },
    })
  );

  const now = Date.now();

  const expiresAt =
    typeof tokenData.expires_in === 'number'
      ? now + tokenData.expires_in * 1000
      : null;

  await dynamoClient.send(
    new PutCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Item: {
        userId,
        provider: 'github',
        accessToken: tokenData.access_token,
        refreshToken:
          tokenData.refresh_token ??
          existingResult.Item?.refreshToken ??
          null,
        expiresAt,
        tokenType:
          tokenData.token_type ?? 'bearer',
        scope:
          tokenData.scope ?? '',
        githubLogin:
          githubUser?.login ?? null,
        githubUserId:
          githubUser?.id != null
            ? String(githubUser.id)
            : null,
        githubName:
          githubUser?.name ?? null,
        githubEmail:
          githubUser?.email ?? null,
        connectedAt:
          existingResult.Item?.connectedAt ??
          new Date().toISOString(),
        updatedAt:
          new Date().toISOString(),
      },
    })
  );
}

async function handleGitHubCallback(event) {
  try {
    const code =
      event?.queryStringParameters?.code;

    const state =
      event?.queryStringParameters?.state;

    const githubError =
      event?.queryStringParameters?.error;

    if (githubError) {
      return redirect(
        `${LUNA_CONNECT_URL}?github=error`
      );
    }

    if (!code) {
      throw new Error(
        'Missing GitHub authorization code'
      );
    }

    const statePayload =
      verifyOAuthState(state);

    const tokenData =
      await exchangeGitHubCode(code);

    const githubUser =
      await getGitHubUser(
        tokenData.access_token
      );

    await saveGitHubTokens(
      statePayload.userId,
      tokenData,
      githubUser
    );

    return redirect(
      `${LUNA_CONNECT_URL}?github=connected`
    );
  } catch (error) {
    console.error(
      'GitHub callback failed:',
      error
    );

    return redirect(
      `${LUNA_CONNECT_URL}?github=error`
    );
  }
}


async function getXCredentials() {
  if (xCredentialsCache) {
    return xCredentialsCache;
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: 'luna/agent-credentials',
    })
  );

  if (!result.SecretString) {
    throw new Error('X credential secret is empty');
  }

  const secret = JSON.parse(result.SecretString);

  if (!secret.X_CLIENT_ID) {
    throw new Error('X_CLIENT_ID missing from luna/agent-credentials');
  }

  if (!secret.X_CLIENT_SECRET) {
    throw new Error('X_CLIENT_SECRET missing from luna/agent-credentials');
  }

  xCredentialsCache = {
    clientId: secret.X_CLIENT_ID,
    clientSecret: secret.X_CLIENT_SECRET,
  };

  return xCredentialsCache;
}

function createPkceVerifier() {
  return createHash('sha256')
    .update(randomUUID() + randomUUID() + randomUUID())
    .digest('base64url');
}

function createPkceChallenge(verifier) {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

async function handleXConnect(event) {
  let auth;

  try {
    auth = await authenticate(event);
  } catch (error) {
    console.error('X connect authentication failed:', error);
    return unauthorized('Invalid or expired authentication token');
  }

  const { clientId } = await getXCredentials();

  const state = createOAuthState(auth.userId);
  const statePayload = verifyOAuthState(state);

  const codeVerifier = createPkceVerifier();
  const codeChallenge = createPkceChallenge(codeVerifier);

  await dynamoClient.send(
    new PutCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Item: {
        userId: auth.userId,
        provider: 'x_oauth_pending',
        stateNonce: statePayload.nonce,
        codeVerifier,
        expiresAt: Date.now() + 10 * 60 * 1000,
        createdAt: new Date().toISOString(),
      },
    })
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: X_REDIRECT_URI,
    scope: 'tweet.read users.read follows.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      authorizationUrl:
        `https://x.com/i/oauth2/authorize?${params.toString()}`,
    }),
  };
}

async function exchangeXCode(code, codeVerifier) {
  const { clientId, clientSecret } =
    await getXCredentials();

  const basicAuth = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString('base64');

  const response = await fetch(
    'https://api.x.com/2/oauth2/token',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type':
          'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: X_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    }
  );

  const tokenData = await response.json();

  if (
    !response.ok ||
    tokenData.error ||
    !tokenData.access_token
  ) {
    console.error(
      'X token exchange failed:',
      tokenData
    );
    throw new Error('X token exchange failed');
  }

  return tokenData;
}

async function getXUser(accessToken) {
  const response = await fetch(
    'https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,verified',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const result = await response.json();

  if (!response.ok || !result?.data) {
    console.error('X user lookup failed:', result);
    throw new Error('X user lookup failed');
  }

  return result.data;
}

async function saveXTokens(
  userId,
  tokenData,
  xUser
) {
  const existingResult = await dynamoClient.send(
    new GetCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Key: {
        userId,
        provider: 'x',
      },
    })
  );

  const now = Date.now();

  const expiresAt =
    typeof tokenData.expires_in === 'number'
      ? now + tokenData.expires_in * 1000
      : null;

  await dynamoClient.send(
    new PutCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Item: {
        userId,
        provider: 'x',
        accessToken: tokenData.access_token,
        refreshToken:
          tokenData.refresh_token ??
          existingResult.Item?.refreshToken ??
          null,
        expiresAt,
        tokenType:
          tokenData.token_type ?? 'bearer',
        scope:
          tokenData.scope ?? '',
        xUserId:
          xUser?.id != null
            ? String(xUser.id)
            : null,
        xUsername:
          xUser?.username ?? null,
        xName:
          xUser?.name ?? null,
        xProfileImageUrl:
          xUser?.profile_image_url ?? null,
        xVerified:
          xUser?.verified ?? false,
        connectedAt:
          existingResult.Item?.connectedAt ??
          new Date().toISOString(),
        updatedAt:
          new Date().toISOString(),
      },
    })
  );
}

async function handleXCallback(event) {
  let pendingKey = null;

  try {
    const code =
      event?.queryStringParameters?.code;

    const state =
      event?.queryStringParameters?.state;

    const xError =
      event?.queryStringParameters?.error;

    if (xError) {
      return redirect(
        `${LUNA_CONNECT_URL}?x=error`
      );
    }

    if (!code) {
      throw new Error(
        'Missing X authorization code'
      );
    }

    if (!state) {
      throw new Error(
        'Missing X OAuth state'
      );
    }

    const statePayload =
      verifyOAuthState(state);

    pendingKey = {
      userId: statePayload.userId,
      provider: 'x_oauth_pending',
    };

    const pendingResult =
      await dynamoClient.send(
        new GetCommand({
          TableName: PROVIDER_TOKEN_TABLE,
          Key: pendingKey,
        })
      );

    const pending = pendingResult.Item;

    if (!pending) {
      throw new Error(
        'X OAuth transaction not found or expired'
      );
    }

    if (
      pending.stateNonce !== statePayload.nonce
    ) {
      throw new Error(
        'X OAuth state mismatch'
      );
    }

    if (
      !pending.expiresAt ||
      Date.now() > pending.expiresAt
    ) {
      throw new Error(
        'X OAuth transaction expired'
      );
    }

    if (!pending.codeVerifier) {
      throw new Error(
        'X PKCE verifier missing'
      );
    }

    const tokenData =
      await exchangeXCode(
        code,
        pending.codeVerifier
      );

    const xUser =
      await getXUser(
        tokenData.access_token
      );

    await saveXTokens(
      statePayload.userId,
      tokenData,
      xUser
    );

    await dynamoClient.send(
      new DeleteCommand({
        TableName: PROVIDER_TOKEN_TABLE,
        Key: pendingKey,
      })
    );

    return redirect(
      `${LUNA_CONNECT_URL}?x=connected`
    );
  } catch (error) {
    console.error(
      'X callback failed:',
      error
    );

    if (pendingKey) {
      try {
        await dynamoClient.send(
          new DeleteCommand({
            TableName: PROVIDER_TOKEN_TABLE,
            Key: pendingKey,
          })
        );
      } catch (cleanupError) {
        console.error(
          'X OAuth cleanup failed:',
          cleanupError
        );
      }
    }

    return redirect(
      `${LUNA_CONNECT_URL}?x=error`
    );
  }
}


async function getSlackCredentials() {
  if (slackCredentialsCache) {
    return slackCredentialsCache;
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: 'luna/agent-credentials',
    })
  );

  if (!result.SecretString) {
    throw new Error(
      'Slack credential secret is empty'
    );
  }

  const secret = JSON.parse(
    result.SecretString
  );

  if (!secret.SLACK_CLIENT_ID) {
    throw new Error(
      'SLACK_CLIENT_ID missing from luna/agent-credentials'
    );
  }

  if (!secret.SLACK_CLIENT_SECRET) {
    throw new Error(
      'SLACK_CLIENT_SECRET missing from luna/agent-credentials'
    );
  }

  slackCredentialsCache = {
    clientId: secret.SLACK_CLIENT_ID,
    clientSecret:
      secret.SLACK_CLIENT_SECRET,
  };

  return slackCredentialsCache;
}

async function handleSlackConnect(event) {
  let auth;

  try {
    auth = await authenticate(event);
  } catch (error) {
    console.error(
      'Slack connect authentication failed:',
      error
    );

    return unauthorized(
      'Invalid or expired authentication token'
    );
  }

  const { clientId } =
    await getSlackCredentials();

  const state =
    createOAuthState(auth.userId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: SLACK_REDIRECT_URI,
    scope: 'users:read,users:read.email',
    state,
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      authorizationUrl:
        `https://slack.com/oauth/v2/authorize?${params.toString()}`,
    }),
  };
}

async function exchangeSlackCode(code) {
  const {
    clientId,
    clientSecret,
  } = await getSlackCredentials();

  const response = await fetch(
    'https://slack.com/api/oauth.v2.access',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: SLACK_REDIRECT_URI,
      }),
    }
  );

  const data = await response.json();

  if (
    !response.ok ||
    !data.ok ||
    !data.access_token
  ) {
    console.error(
      'Slack token exchange failed:',
      data
    );

    throw new Error(
      `Slack token exchange failed: ${
        data?.error ?? 'unknown error'
      }`
    );
  }

  return data;
}

async function getSlackAuthInfo(
  accessToken
) {
  const response = await fetch(
    'https://slack.com/api/auth.test',
    {
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
      },
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    console.error(
      'Slack auth.test failed:',
      data
    );

    throw new Error(
      'Slack workspace lookup failed'
    );
  }

  return data;
}

async function saveSlackTokens(
  userId,
  tokenData,
  authInfo
) {
  const existingResult =
    await dynamoClient.send(
      new GetCommand({
        TableName:
          PROVIDER_TOKEN_TABLE,
        Key: {
          userId,
          provider: 'slack',
        },
      })
    );

  await dynamoClient.send(
    new PutCommand({
      TableName:
        PROVIDER_TOKEN_TABLE,
      Item: {
        userId,
        provider: 'slack',

        accessToken:
          tokenData.access_token,

        tokenType:
          tokenData.token_type ??
          'bot',

        scope:
          tokenData.scope ?? '',

        slackTeamId:
          tokenData.team?.id ??
          authInfo?.team_id ??
          null,

        slackTeamName:
          tokenData.team?.name ??
          authInfo?.team ??
          null,

        slackBotUserId:
          tokenData.bot_user_id ??
          authInfo?.user_id ??
          null,

        slackAppId:
          tokenData.app_id ??
          null,

        connectedAt:
          existingResult.Item
            ?.connectedAt ??
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString(),
      },
    })
  );
}

async function handleSlackCallback(event) {
  try {
    const code =
      event?.queryStringParameters
        ?.code;

    const state =
      event?.queryStringParameters
        ?.state;

    const slackError =
      event?.queryStringParameters
        ?.error;

    if (slackError) {
      return redirect(
        `${LUNA_CONNECT_URL}?slack=error`
      );
    }

    if (!code) {
      throw new Error(
        'Missing Slack authorization code'
      );
    }

    if (!state) {
      throw new Error(
        'Missing Slack OAuth state'
      );
    }

    const statePayload =
      verifyOAuthState(state);

    const tokenData =
      await exchangeSlackCode(code);

    const authInfo =
      await getSlackAuthInfo(
        tokenData.access_token
      );

    await saveSlackTokens(
      statePayload.userId,
      tokenData,
      authInfo
    );

    return redirect(
      `${LUNA_CONNECT_URL}?slack=connected`
    );
  } catch (error) {
    console.error(
      'Slack callback failed:',
      error
    );

    return redirect(
      `${LUNA_CONNECT_URL}?slack=error`
    );
  }
}

async function handleGoogleConnect(event) {
  let auth;

  try {
    auth = await authenticate(event);
  } catch (error) {
    console.error(
      'Google connect authentication failed:',
      error
    );

    return unauthorized(
      'Invalid or expired authentication token'
    );
  }

  const { clientId } =
    await getGoogleCredentials();

  const state = createOAuthState(auth.userId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' '),
  });

  const authorizationUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      authorizationUrl,
    }),
  };
}

async function exchangeGoogleCode(code) {
  const {
    clientId,
    clientSecret,
  } = await getGoogleCredentials();

  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    }
  );

  const tokenData = await response.json();

  if (!response.ok) {
    console.error(
      'Google token exchange failed:',
      response.status,
      tokenData?.error
    );

    throw new Error('Google token exchange failed');
  }

  if (!tokenData.access_token) {
    throw new Error(
      'Google did not return an access token'
    );
  }

  return tokenData;
}

async function getGoogleUserInfo(accessToken) {
  const response = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    console.error(
      'Google userinfo failed:',
      response.status
    );

    return null;
  }

  return await response.json();
}

async function saveGoogleTokens(
  userId,
  tokenData,
  googleUser
) {
  const existingResult =
    await dynamoClient.send(
      new GetCommand({
        TableName: PROVIDER_TOKEN_TABLE,
        Key: {
          userId,
          provider: 'google',
        },
      })
    );

  const existingRefreshToken =
    existingResult.Item?.refreshToken;

  const refreshToken =
    tokenData.refresh_token ??
    existingRefreshToken ??
    null;

  if (!refreshToken) {
    throw new Error(
      'Google did not return a refresh token'
    );
  }

  const now = Date.now();

  const expiresAt =
    typeof tokenData.expires_in === 'number'
      ? now + tokenData.expires_in * 1000
      : null;

  await dynamoClient.send(
    new PutCommand({
      TableName: PROVIDER_TOKEN_TABLE,
      Item: {
        userId,
        provider: 'google',
        accessToken: tokenData.access_token,
        refreshToken,
        expiresAt,
        tokenType:
          tokenData.token_type ?? 'Bearer',
        scope:
          tokenData.scope ?? '',
        googleEmail:
          googleUser?.email ?? null,
        googleSubject:
          googleUser?.sub ?? null,
        connectedAt:
          existingResult.Item?.connectedAt ??
          new Date().toISOString(),
        updatedAt:
          new Date().toISOString(),
      },
    })
  );
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
}

async function handleGoogleCallback(event) {
  try {
    const code =
      event?.queryStringParameters?.code;

    const state =
      event?.queryStringParameters?.state;

    const googleError =
      event?.queryStringParameters?.error;

    if (googleError) {
      console.error(
        'Google OAuth returned error:',
        googleError
      );

      return redirect(
        `${LUNA_CONNECT_URL}?google=error`
      );
    }

    if (!code) {
      throw new Error(
        'Missing Google authorization code'
      );
    }

    const statePayload =
      verifyOAuthState(state);

    const tokenData =
      await exchangeGoogleCode(code);

    const googleUser =
      await getGoogleUserInfo(
        tokenData.access_token
      );

    await saveGoogleTokens(
      statePayload.userId,
      tokenData,
      googleUser
    );

    console.log(
      'Google connected successfully for user:',
      statePayload.userId
    );

    return redirect(
      `${LUNA_CONNECT_URL}?google=connected`
    );
  } catch (error) {
    console.error(
      'Google callback failed:',
      error
    );

    return redirect(
      `${LUNA_CONNECT_URL}?google=error`
    );
  }
}

function getUserScopedRuntimeSessionId(
  userId,
  sessionId
) {
  return createHash('sha256')
    .update(`${userId}:${sessionId}`)
    .digest('hex');
}

async function executeAgent({
  userId,
  email,
  prompt,
  sessionId,
}) {
  const runtimeSessionId =
    getUserScopedRuntimeSessionId(
      userId,
      sessionId
    );

  const command =
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn:
        AGENT_RUNTIME_ARN,
      runtimeSessionId,
      payload: JSON.stringify({
        prompt,
        userId,
        userEmail: email,
      }),
      contentType: 'application/json',
      accept:
        'application/json, text/event-stream',
      qualifier: 'DEFAULT',
    });

  const response =
    await client.send(command);

  const rawAgentResponse =
    (await response.response?.transformToString()) ??
    '';

  const agentResponse =
    rawAgentResponse
      .split('\n')
      .filter((line) =>
        line.startsWith('data: ')
      )
      .map((line) => line.slice(6))
      .map((chunk) => {
        try {
          return JSON.parse(chunk);
        } catch {
          return chunk;
        }
      })
      .join('');

  return agentResponse;
}

async function handleAgent(event) {
  let auth;

  try {
    auth = await authenticate(event);
  } catch (error) {
    console.error(
      'Luna authentication failed:',
      error
    );

    return unauthorized(
      'Invalid or expired authentication token'
    );
  }

  const body =
    typeof event.body === 'string'
      ? JSON.parse(event.body)
      : event.body ?? event;

  const prompt = body?.prompt;

  if (!prompt || typeof prompt !== 'string') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'prompt is required',
      }),
    };
  }

  const sessionId =
    body?.sessionId &&
    typeof body.sessionId === 'string'
      ? body.sessionId
      : randomUUID();

  const jobId = randomUUID();
  const now = new Date().toISOString();

  await dynamoClient.send(
    new PutCommand({
      TableName: AGENT_JOBS_TABLE,
      Item: {
        jobId,
        userId: auth.userId,
        userEmail: auth.email,
        sessionId,
        prompt,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
      },
    })
  );

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName:
          process.env.AWS_LAMBDA_FUNCTION_NAME ||
          'LunaAgentApi',
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({
            __lunaAsyncJob: true,
            jobId,
            userId: auth.userId,
            userEmail: auth.email,
            prompt,
            sessionId,
          })
        ),
      })
    );
  } catch (error) {
    console.error(
      'Failed to start Luna async job:',
      error
    );

    await dynamoClient.send(
      new UpdateCommand({
        TableName: AGENT_JOBS_TABLE,
        Key: { jobId },
        UpdateExpression:
          'SET #status = :status, #error = :error, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#error': 'error',
        },
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':error':
            error?.message ||
            'Failed to start async job',
          ':updatedAt':
            new Date().toISOString(),
        },
      })
    );

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to start Luna job',
      }),
    };
  }

  return {
    statusCode: 202,
    headers,
    body: JSON.stringify({
      success: true,
      jobId,
      sessionId,
      status: 'processing',
    }),
  };
}

async function processAgentJob(event) {
  const {
    jobId,
    userId,
    userEmail,
    prompt,
    sessionId,
  } = event;

  try {
    await dynamoClient.send(
      new UpdateCommand({
        TableName: AGENT_JOBS_TABLE,
        Key: { jobId },
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'running',
          ':updatedAt':
            new Date().toISOString(),
        },
      })
    );

    const agentResponse =
      await executeAgent({
        userId,
        email: userEmail,
        prompt,
        sessionId,
      });

    await dynamoClient.send(
      new UpdateCommand({
        TableName: AGENT_JOBS_TABLE,
        Key: { jobId },
        UpdateExpression:
          'SET #status = :status, #result = :result, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#result': 'result',
        },
        ExpressionAttributeValues: {
          ':status': 'completed',
          ':result': agentResponse,
          ':updatedAt':
            new Date().toISOString(),
        },
      })
    );

    console.log(
      'Luna async job completed:',
      jobId
    );

    return {
      success: true,
      jobId,
    };
  } catch (error) {
    console.error(
      'Luna async job failed:',
      jobId,
      error
    );

    await dynamoClient.send(
      new UpdateCommand({
        TableName: AGENT_JOBS_TABLE,
        Key: { jobId },
        UpdateExpression:
          'SET #status = :status, #error = :error, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#error': 'error',
        },
        ExpressionAttributeValues: {
          ':status': 'failed',
          ':error':
            error?.message ||
            'Luna agent job failed',
          ':updatedAt':
            new Date().toISOString(),
        },
      })
    );

    return {
      success: false,
      jobId,
    };
  }
}

async function handleAgentStatus(event) {
  let auth;

  try {
    auth = await authenticate(event);
  } catch (error) {
    return unauthorized(
      'Invalid or expired authentication token'
    );
  }

  const jobId =
    event?.queryStringParameters?.jobId;

  if (!jobId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'jobId is required',
      }),
    };
  }

  const result =
    await dynamoClient.send(
      new GetCommand({
        TableName: AGENT_JOBS_TABLE,
        Key: { jobId },
      })
    );

  const job = result.Item;

  if (
    !job ||
    job.userId !== auth.userId
  ) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Job not found',
      }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      jobId: job.jobId,
      sessionId: job.sessionId,
      status: job.status,
      response: job.result ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }),
  };
}

export const handler = async (event) => {
  try {
    if (event?.__lunaAsyncJob === true) {
      return await processAgentJob(event);
    }

    if (
      event?.requestContext?.http?.method ===
      'OPTIONS'
    ) {
      return {
        statusCode: 200,
        headers,
        body: '',
      };
    }

    const routeKey = getRouteKey(event);

    if (routeKey === 'GET /google/connect') {
      return await handleGoogleConnect(event);
    }

    if (routeKey === 'GET /google/callback') {
      return await handleGoogleCallback(event);
    }

    if (routeKey === 'GET /github/connect') {
      return await handleGitHubConnect(event);
    }

    if (routeKey === 'GET /github/callback') {
      return await handleGitHubCallback(event);
    }

    if (routeKey === 'GET /x/connect') {
      return await handleXConnect(event);
    }

    if (routeKey === 'GET /x/callback') {
      return await handleXCallback(event);
    }

    if (routeKey === 'GET /slack/connect') {
      return await handleSlackConnect(event);
    }

    if (routeKey === 'GET /slack/callback') {
      return await handleSlackCallback(event);
    }

    if (routeKey === 'GET /agent/status') {
      return await handleAgentStatus(event);
    }

    if (routeKey === 'POST /agent') {
      return await handleAgent(event);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Route not found',
      }),
    };
  } catch (error) {
    console.error('Luna API error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown server error',
      }),
    };
  }
};
