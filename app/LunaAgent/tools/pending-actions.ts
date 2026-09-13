import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'LunaPendingActions';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

const db = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export type PendingActionRecord<T> = {
  approvalId: string;
  actionType: string;
  payload: T;
  createdAt: number;
  expiresAt: number;
};

export async function putPendingAction<T>(
  approvalId: string,
  actionType: string,
  payload: T
) {
  const createdAt = Date.now();

  // DynamoDB TTL requires Unix time in seconds.
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;

  await db.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        approvalId,
        actionType,
        payload,
        createdAt,
        expiresAt,
      },
    })
  );

  return {
    approvalId,
    createdAt,
    expiresAt,
  };
}

export async function getPendingAction<T>(
  approvalId: string,
  expectedActionType: string
): Promise<PendingActionRecord<T> | null> {
  const result = await db.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        approvalId,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  const item = result.Item as PendingActionRecord<T>;

  if (item.actionType !== expectedActionType) {
    return null;
  }

  return item;
}

export async function deletePendingAction(
  approvalId: string
) {
  await db.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        approvalId,
      },
    })
  );
}
