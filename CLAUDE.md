# CLAUDE.md — claude-code-server

## Project Overview

Full-stack web app that deploys Claude Code (via `@anthropic-ai/claude-agent-sdk`) as a persistent headless server. Users submit prompts ("jobs") through a web UI; the server executes them with full tool access in named project directories and streams real-time output via WebSocket.

## Repository Layout

```
claude-code-server/
├── package.json               # Root — only has concurrently + dev scripts
├── projects/                  # Runtime data dir
│   ├── .state.json            # Persisted projects + jobs (last 200 logs/job)
│   └── <ProjectName>/         # One dir per project; Claude's cwd
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # ENTIRE server — single file (~340 lines)
│       └── types.ts           # Shared TypeScript types
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx           # Entry (React.StrictMode enabled)
        ├── App.tsx            # Root component + layout state
        ├── types/index.ts     # Client types (manual copy of server types)
        ├── hooks/
        │   ├── useStore.ts    # WebSocket client + global state
        │   └── api.ts         # REST API client (thin fetch wrapper)
        ├── components/
        │   ├── Sidebar.tsx    # Project list + WS connection indicator
        │   ├── JobList.tsx    # Job cards for selected project
        │   ├── JobDetail.tsx  # Terminal log view + file browser + continue input
        │   ├── NewJobModal.tsx
        │   └── NewProjectModal.tsx
        └── styles/global.css  # All CSS — custom properties, dark theme
```

## Commands

```bash
# Install all dependencies
cd server && npm install && cd ../client && npm install && cd ..
npm install

# Start dev (both server + client)
npm run dev
# Server: http://localhost:3001
# Client: http://localhost:5173 (Vite, open this)

# Build client for production
npm run build:client   # outputs to client/dist/
```

No build step for server — `tsx` executes `.ts` directly. Server restart required on code changes (no HMR). Client has Vite HMR.

## Tech Stack

- **Server**: Express 4, ws 8, `@anthropic-ai/claude-agent-sdk`, uuid, cors, tsx (no build)
- **Client**: React 18, Vite 5, lucide-react (icons), no CSS framework
- **Root**: concurrently (runs server + client in parallel)
- **TypeScript**: strict mode in both server and client

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Express server port |
| `PROJECTS_ROOT` | `../projects` (relative to server/) | Root dir for project workspaces |
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key for Claude Agent SDK |

## Architecture

### Communication: REST + WebSocket

Vite proxies `/api` → `http://localhost:3001` and `/ws` → `ws://localhost:3001` in dev. Client uses only relative paths.

**REST endpoints** (`/api`):
- `GET/POST /projects` — CRUD projects
- `GET/POST /jobs` — list/create jobs; `GET /jobs/:id` returns full logs
- `POST /jobs/:id/continue` — resume session with follow-up prompt
- `POST /jobs/:id/stop` — abort running job
- `POST /jobs/:id/archive` — archive job
- `GET /projects/:id/files[/*]` — file browser

**WebSocket events** (server → client):
- `init` — full state on connect (jobs without logs)
- `project:created`, `job:created` — new entities
- `job:updated` — status/metadata changes
- `job:log` — individual log entries (real-time streaming)

### Server: Single-file backend (`server/src/index.ts`)

- In-memory state: `projects[]`, `jobs[]`, `activeQueries` Map
- Persisted to `projects/.state.json` on every mutation (last 200 logs/job)
- On restart: `running` jobs marked as `failed`
- Job runner: async generator from `query()` SDK call; streams `SDKMessage` types
- SDK config: `bypassPermissions`, thinking disabled, interactive tools disallowed
- `systemPrompt`: preset `claude_code` + batch-mode instructions

### Client: React + custom hooks

- **No state library** — `useStore()` custom hook owns all state via `useState`
- WebSocket auto-reconnects every 2s; guards against duplicate connections (StrictMode-safe)
- `JobDetail` deduplicates REST + WS logs using `timestamp|type|content` key
- All styles in single `global.css` with CSS custom properties (dark theme, JetBrains Mono + Inter fonts)

## Data Models

```typescript
type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'archived';

interface Project { id: string; name: string; path: string; createdAt: string; }

interface Job {
  id: string; projectId: string; prompt: string; status: JobStatus;
  sessionId?: string;    // Claude SDK session ID (for resume)
  result?: string; error?: string; costUsd?: number;
  tokenUsage?: { input: number; output: number };
  logs: LogEntry[];
  createdAt: string; updatedAt: string;
}

interface LogEntry {
  timestamp: string;
  type: 'text' | 'tool' | 'system' | 'error' | 'result';
  content: string;
  meta?: Record<string, unknown>;
}
```

**Types are manually duplicated** between `server/src/types.ts` and `client/src/types/index.ts`. Keep them in sync.

## Code Conventions

- **TypeScript strict** — no implicit any; `as any` only for SDK message parsing escape hatches
- **Named exports** for components: `export function JobList(...)`; default export only for `App`
- **Interface Props** pattern: define `interface Props { ... }` above each component
- **ISO 8601 strings** for all timestamps (not Date objects)
- **Server imports** require `.js` extension for ESM: `import type { Job } from './types.js'`
- **Client imports** omit extension: `import type { Job } from '../types'`
- **CSS classes**: kebab-case (`.job-card`, `.badge-running`, `.split-left`)
- **No tests, no linting config** — no ESLint, Prettier, Jest, or CI

## Important Notes

1. **`projects/` dir** is where Claude writes files at runtime — not gitignored by default
2. **Session resume**: `job.sessionId` is passed as `opts.resume` when continuing; "Continue" UI only appears if `sessionId` exists and job is completed/failed
3. **Project name sanitization**: `/[^a-zA-Z0-9_-]/g` → `_` for directory names
4. **File browser security**: path traversal guard via `filePath.startsWith(project.path)`; dotfiles and `node_modules` filtered from listings
5. **Tool result truncation**: logged results capped at 2000 chars (execution not truncated)
6. **CORS wide open**: `cors()` with no config — restrict in production
7. **No auth**: zero authentication — designed for local/trusted network only
8. **React StrictMode** is enabled in dev — WebSocket code must handle double-mount
