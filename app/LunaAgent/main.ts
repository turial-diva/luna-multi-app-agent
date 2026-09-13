import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent, McpClient, tool, type ToolList } from '@strands-agents/sdk';
import { z } from 'zod';
import { loadModel } from './model/load.js';
import { getStreamableHttpMcpClient } from './mcp_client/client.js';
import { searchGitHub } from './tools/github.js';
import { searchX } from './tools/x.js';
import { createSearchSlackPeople } from './tools/slack.js';
import { searchGoogleContacts, findGoogleWarmPath } from './tools/google-contacts.js';
import { searchGmailRelationship } from './tools/gmail.js';
import { requestGmailSendApproval, approveAndSendGmail } from './tools/gmail-send.js';
import { getCalendarAvailability } from './tools/calendar.js';
import { requestCalendarEventApproval, approveAndCreateCalendarEvent } from './tools/calendar-create.js';

// Define a collection of MCP clients (filter out anything that failed to initialize)
const mcpClients: McpClient[] = [getStreamableHttpMcpClient()].filter(
  (client): client is McpClient => Boolean(client)
);

// Define a collection of tools used by the model
const tools: ToolList = [];
tools.push(searchGitHub);
tools.push(searchX);
tools.push(searchGoogleContacts);
tools.push(findGoogleWarmPath);
tools.push(searchGmailRelationship);
tools.push(requestGmailSendApproval);
tools.push(getCalendarAvailability);
tools.push(requestCalendarEventApproval);

// Add MCP clients to tools
tools.push(...mcpClients);

const SYSTEM_PROMPT = `
You are Luna, an autonomous networking agent for founders and professionals.

Your goal is to help the user turn a networking objective into a real meeting.

You can:
- discover relevant professionals
- evaluate and rank candidates based on evidence
- identify credible warm introduction paths
- use available tools to gather information
- draft introductions and outreach
- help coordinate meetings

Operate proactively. Use available tools instead of only telling the user what to do.

Never invent people, qualifications, relationships, or warm introduction paths.

Before sending a message, email, introduction, or booking a meeting, ask for explicit user approval.

Be concise and action-oriented.

SEARCH STRATEGY:
- Prefer the most relevant first-party source for the user's request.
- For X-related discovery, use search_x_candidates first.

- For people in the user's connected Slack workspace, use search_slack_people.

- Slack workspace membership is a connection signal, but never claim it proves a close relationship or warm introduction.

- Use Slack alongside Google Contacts/Gmail when evaluating whether the user may already have a credible path to a candidate.
- For technical candidates, use GitHub to discover or verify technical evidence.
- Use web search as a fallback or enrichment source when X or GitHub does not provide enough evidence.
- Cross-check important candidate claims when useful.

EFFICIENCY:
- Do not repeatedly retry substantially similar searches.
- Normally make no more than 3 searches with the same tool for the same objective.
- If a source is not producing useful results after a few attempts, switch sources.
- Once you have enough evidence to answer the user's request, STOP searching and return the result.
- For a request for 3 candidates, stop once you have 3 credible candidates with enough evidence to explain why each is relevant.
- Once you have 3 credible candidates, do not continue broad candidate discovery.
- If X activity needs verification, make at most ONE X verification search per candidate.
- If that X verification does not provide sufficient evidence, mark the X activity as unverified and continue with the evidence already available.
- Do not repeatedly search X or the web trying to prove X activity after a verification attempt fails.
- Prefer a strong answer from available evidence over exhaustive research.

CALENDAR:
- Use get_calendar_availability before proposing meeting times when availability matters.
- Always pass calendar start/end values as full ISO 8601 datetimes including timezone offset.
- For America/Toronto, account correctly for EST or EDT for the requested date.
- Never create or claim to create a calendar event without explicit user approval.
- To prepare a meeting, call request_calendar_event_approval.
- Show the exact title, date, start time, end time, timezone, and attendee before approval.
- request_calendar_event_approval does NOT create the event.
- Tell the user to reply APPROVE CALENDAR followed by the approval ID.
- Never claim an invitation was sent until the application confirms successful event creation.
- Do not invent weekday names. If mentioning a weekday, ensure it matches the actual calendar date.

EMAIL SENDING:
- Never claim an email has been sent unless the application confirms it.
- When the user wants to send an email, first finalize the exact recipient, subject, and body.
- Then call request_gmail_send_approval.
- Show the user the exact email and approval ID.
- Tell the user they must explicitly reply with APPROVE followed by that approval ID.
- request_gmail_send_approval does NOT send the email.
- Do not say or imply that drafting or requesting approval sent the email.

GOOGLE TOOL ROUTING:
- If the user asks whether they have emailed someone, exchanged emails, had prior email communication, or asks about Gmail history, ALWAYS use search_gmail_relationship.
- Do NOT use search_google_contacts to answer questions about email history.
- search_google_contacts only proves whether someone is stored in Google Contacts.
- find_google_warm_path checks direct contacts, company matches, and email-domain matches in saved contacts.
- A missing Google Contact does NOT mean there is no Gmail relationship.
- Never claim email history was checked unless search_gmail_relationship was actually used.

SOURCE HONESTY:
- Clearly distinguish evidence found directly on X, GitHub, or other sources.
- Do not claim someone is active on X unless X evidence supports it.
- Information found through web search or LinkedIn may be used as supporting evidence, but do not present it as X evidence.
- Never invent an X handle, relationship, qualification, location, or warm introduction path.
`;

const requestSchema = z.object({
  prompt: z.string().default(''),
  userId: z.string().optional(),
  userEmail: z.string().optional(),
});

const AGENT_CACHE_LIMIT = 128;

// Reuses one Agent per sessionId so each session keeps its own in-process
// conversation history (best-effort; resets on cold start). A Map preserves
// insertion order, so it doubles as an LRU bounded to 128 sessions — a local
// dev process serving many sessions cannot leak history between them or grow
// without bound. On AgentCore Runtime each microVM serves a single session, so
// this holds one entry. For durable history, attach memory.
const agentCache = new Map<string, Agent>();

async function getOrCreateAgent(
  sessionId: string,
  userId?: string
): Promise<Agent> {
  const existing = agentCache.get(sessionId);
  if (existing) {
    agentCache.delete(sessionId);
    agentCache.set(sessionId, existing);
    return existing;
  }
  if (agentCache.size >= AGENT_CACHE_LIMIT) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  const model = await loadModel();

  const sessionTools: ToolList = [...tools];

  if (userId) {
    sessionTools.push(createSearchSlackPeople(userId));
  }

  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    tools: sessionTools,
  });
  agentCache.set(sessionId, agent);
  return agent;
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema,
    async *process(payload, context) {
      const sessionId = context?.sessionId ?? 'default-session';

      // AgentCore CLI may wrap a JSON payload inside payload.prompt.
      // Normalize both CLI and production Lambda invocation formats.
      let normalizedPrompt = payload.prompt;
      let normalizedUserId = payload.userId;
      let normalizedUserEmail = payload.userEmail;

      if (!normalizedUserId && typeof payload.prompt === 'string') {
        try {
          const parsed = JSON.parse(payload.prompt);

          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.prompt === 'string') {
              normalizedPrompt = parsed.prompt;
            }

            if (typeof parsed.userId === 'string') {
              normalizedUserId = parsed.userId;
            }

            if (typeof parsed.userEmail === 'string') {
              normalizedUserEmail = parsed.userEmail;
            }
          }
        } catch {
          // Normal plain-text prompt; no normalization needed.
        }
      }

      const agent = await getOrCreateAgent(
        sessionId,
        normalizedUserId
      );

      // Calendar consequential-action gate
      const calendarApprovalMatch = normalizedPrompt
        .trim()
        .match(/^APPROVE\s+CALENDAR\s+([a-f0-9-]+)$/i);

      if (calendarApprovalMatch) {
        try {
          const result = await approveAndCreateCalendarEvent(
            calendarApprovalMatch[1]
          );

          yield {
            data: `Calendar event created successfully: ${result.summary}. Start: ${result.start}.${result.attendeeEmail ? ` Invitation sent to ${result.attendeeEmail}.` : ''}`,
          };
        } catch (error) {
          yield {
            data: `Calendar event was not created: ${
              error instanceof Error ? error.message : 'Unknown approval error'
            }`,
          };
        }

        return;
      }

      // Consequential-action gate:
      // Only an explicit APPROVE <id> message can send a pending Gmail action.
      const approvalMatch = normalizedPrompt
        .trim()
        .match(/^APPROVE\s+([a-f0-9-]+)$/i);

      if (approvalMatch) {
        try {
          const result = await approveAndSendGmail(approvalMatch[1]);

          yield {
            data: `Email sent successfully to ${result.to}. Subject: ${result.subject}`,
          };
        } catch (error) {
          yield {
            data: `Email was not sent: ${
              error instanceof Error ? error.message : 'Unknown approval error'
            }`,
          };
        }

        return;
      }

      // Snapshot history before streaming so a failed turn can be rolled back.
      // Agent.stream() appends the user message before invoking the model; on a
      // mid-stream error that user turn would otherwise linger in the cached
      // agent, and the next turn for this session would send consecutive user
      // messages (rejected by providers that require strict role alternation,
      // e.g. Anthropic). Restoring on error keeps the session reusable.
      const snapshot = agent.takeSnapshot({ include: ['messages'] });
      try {
        const currentTorontoTime = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Toronto',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZoneName: 'short',
        }).format(new Date());

        const promptWithTimeContext = `
CURRENT DATE/TIME:
The current date and time in America/Toronto is ${currentTorontoTime}.
Use this when interpreting relative dates such as today, tomorrow, tonight, next week, Monday, or this weekend.
Never invent or assume a different current date.

USER REQUEST:
${normalizedPrompt}
`;

        for await (const event of agent.stream(promptWithTimeContext)) {
          if (
            event.type === 'modelStreamUpdateEvent' &&
            event.event?.type === 'modelContentBlockDeltaEvent' &&
            event.event.delta?.type === 'textDelta'
          ) {
            yield { data: event.event.delta.text };
          }
        }
      } catch (error) {
        agent.loadSnapshot(snapshot);
        throw error;
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });
