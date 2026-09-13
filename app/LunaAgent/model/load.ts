import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

export function loadModel(): BedrockModel {
  return new BedrockModel({ modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0' });
}
