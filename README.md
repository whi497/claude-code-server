# Claude Code Server

A full-stack system for deploying Claude Code as a persistent server. Submit jobs, manage projects, and view real-time output—all through a web UI.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (React + TypeScript)                       │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Sidebar  │ │ Job List │ │ Job Detail / Terminal│ │
│  │(Projects)│ │          │ │ + File Browser       │ │
│  └─────────┘ └──────────┘ └──────────────────────┘ │
│                    ▲ WebSocket (real-time logs)      │
└────────────────────┼────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────┐
│  Server (Express + WebSocket)                        │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────┐  │
│  │ REST API │ │ WS Broker  │ │ Job Runner        │  │
│  │ Projects │ │ broadcast  │ │ @anthropic-ai/    │  │
│  │ Jobs     │ │ logs       │ │ claude-agent-sdk  │  │
│  └──────────┘ └────────────┘ └───────────────────┘  │
│                                      │               │
│                            ┌─────────▼─────────┐    │
│                            │ /projects/<name>   │    │
│                            │ (working dirs)     │    │
│                            └───────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Features

- **Project Management** — Create named projects, each with its own working directory under `/projects`
- **Job Submission** — Send prompts to Claude Code which executes with full tool access (Bash, Read, Write, Edit, Glob, Grep, WebSearch)
- **Real-time Streaming** — WebSocket-powered live output of Claude's reasoning, tool calls, and results
- **Persistent Sessions** — Jobs stay alive and sessions can be resumed with follow-up prompts
- **File Browser** — View files Claude has created or modified in the project directory
- **Job Lifecycle** — Queue → Running → Completed/Failed, with stop and archive controls

## Prerequisites

- **Node.js 18+**
- **Anthropic API Key** — set `ANTHROPIC_API_KEY` environment variable
- **Claude Code** — The Agent SDK requires the Claude Code CLI installed (`npm i -g @anthropic-ai/claude-agent-sdk`)

## Quick Start

```bash
# 1. Clone and install
cd claude-code-server
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. Set API key
export ANTHROPIC_API_KEY=your-key-here

# 3. Start both server and client
npm install        # installs concurrently
npm run dev

# Server runs on :3001, Client on :5173 (proxied)
# Open http://localhost:5173
```

## Configuration

| Env Variable       | Default                    | Description                   |
|--------------------|----------------------------|-------------------------------|
| `PORT`             | `3001`                     | Server port                   |
| `PROJECTS_ROOT`    | `./projects`               | Root directory for projects   |
| `ANTHROPIC_API_KEY`| (required)                 | Your Anthropic API key        |

## API Endpoints

| Method | Path                          | Description                    |
|--------|-------------------------------|--------------------------------|
| GET    | `/api/projects`               | List all projects              |
| POST   | `/api/projects`               | Create project `{name}`        |
| DELETE  | `/api/projects/:id`           | Delete project                 |
| GET    | `/api/jobs?projectId=`        | List jobs (optional filter)    |
| GET    | `/api/jobs/:id`               | Get job with full logs         |
| POST   | `/api/jobs`                   | Create job `{projectId,prompt}`|
| POST   | `/api/jobs/:id/stop`          | Stop running job               |
| POST   | `/api/jobs/:id/archive`       | Archive job                    |
| POST   | `/api/jobs/:id/continue`      | Resume session `{prompt}`      |
| GET    | `/api/projects/:id/files`     | List project files             |
| GET    | `/api/projects/:id/files/*`   | Read file content              |

## WebSocket

Connect to `ws://host/ws` for real-time events:

- `init` — Full state on connect
- `project:created` — New project
- `job:created` — New job
- `job:updated` — Job status/metadata change
- `job:log` — New log entry for a job

## Agent SDK Integration

Jobs use the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with:

- **Tools**: `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep`, `WebSearch`, `WebFetch`
- **Permission mode**: `bypassPermissions` (headless server, no interactive prompts)
- **Session persistence**: Sessions are saved and can be resumed via the "Continue" feature
- **Working directory**: Each project has its own directory under `PROJECTS_ROOT`

## Production Deployment

For production, build the client and serve statically:

```bash
cd client && npm run build
# Serve client/dist as static files from Express
# Or use nginx/caddy to serve client + proxy /api and /ws to server
```

## License

MIT
