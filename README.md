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

```
my-project/
├── AGENTS.md               # AI coding assistant context
├── agentcore/
│   ├── agentcore.json      # Project config (agents, memories, credentials, gateways, evaluators)
│   ├── aws-targets.json    # Deployment targets (account + region)
│   ├── .env.local          # Secrets — API keys (gitignored)
│   ├── .llm-context/       # TypeScript type definitions for AI assistants
│   │   ├── agentcore.ts    # AgentCoreProjectSpec types
│   │   └── aws-targets.ts  # Deployment target types
│   └── cdk/                # CDK infrastructure (@aws/agentcore-cdk)
├── app/                    # Agent application code
└── evaluators/             # Custom evaluator code (if any)
```

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
