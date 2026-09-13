import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET;

const GOOGLE_REDIRECT_URI =
  'https://6e0c987ln3.execute-api.us-east-1.amazonaws.com/google/callback';

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

  const runtimeSessionId =
    getUserScopedRuntimeSessionId(
      auth.userId,
      sessionId
    );

  const command =
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn:
        AGENT_RUNTIME_ARN,
      runtimeSessionId,
      payload: JSON.stringify({
        prompt,
        userId: auth.userId,
        userEmail: auth.email,
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

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      sessionId,
      response: agentResponse,
    }),
  };
}

export const handler = async (event) => {
  try {
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
