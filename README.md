# Luna — Autonomous Networking Agent

**One request → Discover → Verify → Connect → Act**

Luna is an autonomous networking agent for founders and professionals. Give Luna a networking goal once, and it works across multiple applications to discover relevant people, verify credible connection paths, prepare outreach, and help turn the connection into a real meeting.

## Demo

**2-Minute Demo:** https://youtu.be/rhd7PJBfB7w

**Live App:** https://lunaagent.nc-connect.app

---

## 1. Project Overview

Professional networking is fragmented across discovery, communication, contacts, and scheduling tools.

Finding someone may start on GitHub or X. Understanding whether you know them requires searching Contacts, Gmail, or Slack. Outreach happens somewhere else, and scheduling requires another application.

Luna turns this fragmented workflow into one agentic process.

Example request:

> Find me a technical cofounder in Toronto actively building AI agents. Find the strongest person I can realistically meet and help me get introduced.

Luna can:

1. Discover real candidates using GitHub and X.
2. Rank candidates using source-grounded evidence.
3. Search Google Contacts, Gmail, and Slack for credible connection paths.
4. Refuse to invent a warm introduction when one cannot be verified.
5. Fall back to direct outreach when no credible warm path exists.
6. Prepare personalized Gmail outreach.
7. Require explicit human approval before sending email.
8. Check real Google Calendar availability.
9. Require explicit approval before creating meetings.
10. Execute approved actions through the connected applications.

---

## 2. External Apps Used

Luna connects to six external applications:

| App | How Luna Uses It |
|---|---|
| GitHub | Finds technical candidates and verifies technical/project activity |
| X | Finds public professional and interest signals |
| Google Contacts | Searches existing contacts for relationship paths |
| Gmail | Verifies relationship history and sends approved outreach |
| Slack | Searches the connected workspace for people and connection signals |
| Google Calendar | Checks availability and creates approved meetings |

---

## 3. End-to-End Workflow

```text
NETWORKING GOAL
      ↓
DISCOVER
GitHub + X
      ↓
RANK CANDIDATES
Source-grounded evidence
      ↓
VERIFY CONNECTION PATH
Google Contacts + Gmail + Slack
      ↓
Credible warm path?
   ↙         ↘
 YES         NO
  ↓           ↓
Warm intro   Direct outreach
      ↘     ↙
     PREPARE
        ↓
 HUMAN APPROVAL
        ↓
   Gmail execution
        ↓
Calendar availability
        ↓
 HUMAN APPROVAL
        ↓
 Meeting created

This project was created with the [AgentCore CLI](https://github.com/aws/agentcore-cli).

## Project Structure

```text
luna-multi-app-agent/
├── AGENTS.md
├── agentcore/
│   ├── agentcore.json
│   └── cdk/
├── app/
│   └── LunaAgent/
│       ├── main.ts
│       ├── tools/
│       │   ├── github.ts
│       │   ├── x.ts
│       │   ├── google-contacts.ts
│       │   ├── gmail.ts
│       │   ├── gmail-send.ts
│       │   ├── calendar.ts
│       │   ├── calendar-create.ts
│       │   ├── slack.ts
│       │   └── pending-actions.ts
│       ├── model/
│       └── mcp_client/
├── luna-api-lambda/
│   └── index.mjs
└── README.md
```

---
## How Luna Was Built — From User Request to Real-World Action

Luna is not a single API call or a chatbot connected to a few services. It is a multi-step agent system built by combining **Strands Agents SDK, Amazon Bedrock, Amazon Bedrock AgentCore, AWS infrastructure, and six external applications**.

Here is the system in plain English.

### 1. The user gives Luna a goal

Everything starts with a natural-language request in the Luna web app.

For example:

> "Find me a technical cofounder in Toronto actively building AI agents. Find the strongest person I can realistically meet and help me get introduced."

The user does not need to tell Luna which applications to search or every individual step to perform.

---

### 2. The request reaches the AWS backend

```text
Luna Web App
      ↓
Authenticated API
      ↓
Amazon API Gateway
      ↓
AWS Lambda
      ↓
Amazon Bedrock AgentCore
```

The web application authenticates the user and sends the request through an API built with **Amazon API Gateway and AWS Lambda**.

Long-running agent requests are handled asynchronously. **Amazon DynamoDB** stores job state so the frontend can poll for the result without being limited by the API request timeout.

Lambda then invokes Luna running in **Amazon Bedrock AgentCore**.

---

### 3. Strands Agents SDK is Luna's orchestration layer

Inside AgentCore, Luna is built using the **Strands Agents SDK**.

Strands provides the agent loop that connects:

```text
User goal
   ↓
LLM reasoning
   ↓
Choose a tool
   ↓
Observe the result
   ↓
Reason about the new evidence
   ↓
Choose the next action
   ↓
Continue until the goal is completed
```

Instead of hard-coding one fixed sequence of API calls, Luna is given a set of tools and instructions. The agent determines which tools are appropriate based on the user's goal and the evidence returned during execution.

This is what turns Luna from a traditional workflow into an **agentic system**.

---

### 4. Amazon Bedrock provides the intelligence

The Strands agent uses a foundation model through **Amazon Bedrock** for reasoning.

Bedrock helps Luna understand the user's intent, interpret evidence returned by tools, compare candidates, decide which additional information is needed, and determine the appropriate next step.

The separation is roughly:

```text
Amazon Bedrock
      ↓
Reasoning

Strands Agents SDK
      ↓
Agent orchestration + tool use

Amazon Bedrock AgentCore
      ↓
Production agent runtime
```

---

### 5. Luna's capabilities are implemented as tools

Each external capability is exposed to the Strands agent as a tool.

```text
Strands Agent
     │
     ├── GitHub Search Tool
     ├── X Search Tool
     ├── Google Contacts Tool
     ├── Gmail Relationship Tool
     ├── Gmail Send Tool
     ├── Slack People Search Tool
     ├── Calendar Availability Tool
     └── Calendar Event Tool
```

The tools have different responsibilities.

| Tool / Service | Role in Luna |
|---|---|
| GitHub | Discover technical people and inspect public technical/project evidence |
| X | Discover public professional and interest signals |
| Google Contacts | Determine whether a candidate or potential connector already exists in the user's network |
| Gmail | Look for evidence of an existing relationship or previous communication |
| Slack | Search the user's connected workspace for additional connection signals |
| Gmail Send | Execute outreach after explicit human approval |
| Google Calendar | Check real availability and create approved meetings |

This allows the model to **reason**, while deterministic application code performs the actual external actions.

---

### 6. Luna discovers and ranks candidates

For a networking request, Luna can first use **GitHub and X** to discover people relevant to the user's goal.

```text
User goal
    ↓
GitHub + X
    ↓
Candidate evidence
    ↓
Compare and rank
    ↓
Strongest candidates
```

Candidate recommendations must be grounded in information returned by the tools. Luna is instructed not to invent people, qualifications, or evidence.

---

### 7. Luna tries to verify a real connection path

Finding a good person is only part of networking. Luna then tries to determine whether the user has a credible way to reach that person.

It can search:

```text
Google Contacts
       +
     Gmail
       +
     Slack
       ↓
Relationship evidence
```

These sources provide different signals.

For example, previous email history is stronger evidence of an existing relationship than simply belonging to the same Slack workspace.

Luna evaluates the evidence rather than automatically calling every signal a "warm connection."

---

### 8. Luna has a no-hallucination fallback

If Luna cannot verify a credible warm path, the workflow does not fail — and Luna does not invent one.

```text
Strong candidate
      ↓
Search connection evidence
      ↓
Credible warm path?
   ↙             ↘
 YES              NO
  ↓                ↓
Warm introduction  State that no credible
path               warm path was verified
                       ↓
                  Direct outreach
```

The candidate can still be recommended. Luna simply changes the strategy from a warm introduction to direct outreach.

---

### 9. Human approval separates reasoning from consequential actions

Luna can autonomously research, compare, verify, and prepare actions.

But sending an email or creating a calendar event crosses an execution boundary.

For those actions:

```text
Luna reasons
     ↓
Prepares action
     ↓
Creates pending approval
     ↓
STOPS
     ↓
Human reviews
     ↓
Explicit approval
     ↓
Action executes
```

Pending approvals are stored in **Amazon DynamoDB**, rather than existing only inside the model's conversation.

This creates a deterministic boundary between:

**AI reasoning** and **real-world execution**.

---

### 10. Approved outreach is executed through Gmail

Once the user explicitly approves an outreach action, Luna executes the approved Gmail operation.

```text
Prepared outreach
      ↓
Human approval
      ↓
Validate approval
      ↓
Gmail API
      ↓
Email sent
      ↓
Result returned to Luna
```

Luna therefore does not claim that an email was sent simply because the model decided to send one. The external action must actually execute.

---

### 11. Luna can continue from outreach to scheduling

The workflow can continue into Google Calendar.

Luna can check real availability first:

```text
Google Calendar
      ↓
Free/busy information
      ↓
Available time
```

Creating an event requires another explicit approval:

```text
Proposed meeting
      ↓
Human approval
      ↓
Google Calendar API
      ↓
Meeting created
```

This lets one networking goal move from **discovery all the way to a real meeting**.

---

### 12. AWS services provide the production infrastructure

Several AWS services support the agent around the Strands reasoning loop.

| AWS Service | Purpose |
|---|---|
| Amazon Bedrock | Foundation-model reasoning |
| Amazon Bedrock AgentCore | Runs the deployed Luna agent |
| Strands Agents SDK | Agent orchestration and tool calling |
| AWS Lambda | Authenticated API bridge and asynchronous job execution |
| Amazon API Gateway | Public backend API |
| Amazon DynamoDB | Async jobs, approval state, and provider-token/application state |
| AWS Secrets Manager | Secure storage for API/OAuth credentials |
| AWS IAM | Controls access between AWS resources |
| Amazon CloudWatch / AgentCore Observability | Runtime logging, debugging, and observability |

User authentication and profile information are integrated with **Supabase**, while AWS runs the agent and its execution infrastructure.

---

### Putting Everything Together

A complete Luna workflow looks like this:

```text
USER
"Find me a technical cofounder..."
        ↓
LUNA WEB APP
        ↓
AUTHENTICATED API
        ↓
API GATEWAY + LAMBDA
        ↓
BEDROCK AGENTCORE
        ↓
STRANDS AGENT
        ↓
AMAZON BEDROCK
        ↓
UNDERSTAND NETWORKING GOAL
        ↓
DISCOVER
GitHub + X
        ↓
RANK
Source-grounded candidates
        ↓
VERIFY
Google Contacts + Gmail + Slack
        ↓
CONNECTION DECISION
Warm path OR direct outreach
        ↓
PREPARE OUTREACH
        ↓
HUMAN APPROVAL
        ↓
GMAIL EXECUTION
        ↓
CHECK CALENDAR
        ↓
HUMAN APPROVAL
        ↓
CREATE MEETING
        ↓
GOAL COMPLETED
```

The result is a system where **Bedrock provides reasoning, Strands orchestrates the agent and its tools, AgentCore runs the agent, AWS services provide the production infrastructure, and external applications allow Luna to perform real work.**

The goal is not simply to answer:

> "Who should I meet?"

It is to take the user's networking objective from **intent → evidence → connection → approved action → real meeting**.
---

## Getting Started

### Prerequisites

- **Node.js** 20.x or later
- **Python 3.10+** and **uv** for Python agents ([install uv](https://docs.astral.sh/uv/getting-started/installation/))
- **AWS credentials** configured (`aws configure` or environment variables)
- **Docker** (only for Container build agents)

### Development

Run your agent locally:

```bash
agentcore dev
```

### Validate Invocation Input

Validate runtime invocation payloads before forwarding them to an agent framework. Keep user prompts typed as strings
and pass only prompt text to the agent.

### Deployment

Deploy to AWS:

```bash
agentcore deploy
```

## Commands

| Command | Description |
| --- | --- |
| `agentcore create` | Create a new AgentCore project |
| `agentcore add` | Add resources (agent, memory, credential, gateway, evaluator, policy) |
| `agentcore remove` | Remove resources |
| `agentcore dev` | Run agent locally with hot-reload |
| `agentcore deploy` | Deploy to AWS via CDK |
| `agentcore status` | Show deployment status |
| `agentcore invoke` | Invoke agent (local or deployed) |
| `agentcore logs` | View agent logs |
| `agentcore traces` | View agent traces |
| `agentcore eval` | Run evaluations |
| `agentcore package` | Package agent artifacts |
| `agentcore validate` | Validate configuration |
| `agentcore pause` | Pause a deployed agent |
| `agentcore resume` | Resume a paused agent |
| `agentcore fetch` | Fetch remote resource definitions |
| `agentcore import` | Import existing resources |
| `agentcore update` | Check for CLI updates |

## Configuration

Edit the JSON files in `agentcore/` to configure your project. See `agentcore/.llm-context/` for type definitions and validation constraints.

The project uses a **flat resource model** — agents, memories, credentials, gateways, evaluators, and policies are top-level arrays in `agentcore.json`. Resources are independent; agents discover memories and credentials at runtime via environment variables or SDK calls.

## Resources

| Resource | Purpose |
| --- | --- |
| Agent (runtime) | HTTP, MCP, or A2A agent deployed to AgentCore Runtime |
| Memory | Persistent context storage with configurable strategies |
| Credential | API key or OAuth credential providers |
| Gateway | MCP gateway that routes tool calls to targets |
| Gateway Target | Tool implementation (Lambda, MCP server, OpenAPI, Smithy, API Gateway) |
| Evaluator | Custom LLM-as-a-Judge or code-based evaluation |
| Online Eval Config | Continuous evaluation pipeline for deployed agents |
| Policy | Cedar authorization policies for gateway tools |

### Agent Types

- **Template agents**: Created from framework templates (Strands, LangChain/LangGraph, GoogleADK, OpenAI Agents, Autogen)
- **BYO agents**: Bring your own code with `agentcore add agent --type byo`
- **Import agents**: Import existing Bedrock agents with `agentcore import`

### Build Types

- **CodeZip**: Python source packaged as a zip and deployed directly to AgentCore Runtime
- **Container**: Docker image built via CodeBuild (ARM64), pushed to ECR, and deployed to AgentCore Runtime

## Documentation

- [AgentCore CLI](https://github.com/aws/agentcore-cli)
- [AgentCore CDK Constructs](https://github.com/aws/agentcore-l3-cdk-constructs)
- [Amazon Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/)


## Demo

🎥 **2-Minute Demo:** https://youtu.be/rhd7PJBfB7w

🌐 **Live Luna:** https://lunaagent.nc-connect.app
