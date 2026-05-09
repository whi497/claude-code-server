# claude-code-server

## Project Overview
This file governs the entire repository.

Full-stack web app that deploys Claude Code (via `@anthropic-ai/claude-agent-sdk`) as a persistent headless server. Users submit prompts ("jobs") through a web UI; the server executes them with full tool access in named project directories and streams real-time output via WebSocket. Features include an approval system for interactive tools, slash command integration, subagent nesting, and a command palette for quick navigation.

## Repository Layout
When touching "convert to session", "pin as session", or resume behavior, keep these concepts separate:

```
claude-code-server/
├── package.json               # Root — concurrently (dev), pm2 scripts (prod)
├── ecosystem.config.cjs       # PM2 process config (auto-restart, logging)
├── setup.sh                   # One-click install + launch (dev/prod/install-only)
├── projects/                  # Runtime data dir
│   ├── .state.json            # Persisted projects + jobs (last 200 logs/job)
│   └── <ProjectName>/         # One dir per project; Claude's cwd
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # ENTIRE server — single file (~900+ lines)
│       └── types.ts           # Shared TypeScript types
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx           # Entry (React.StrictMode enabled)
        ├── App.tsx            # Root component + resizable panels + command palette
        ├── types/index.ts     # Client types (manual copy of server types)
        ├── hooks/
        │   ├── useStore.ts    # WebSocket client + global state
        │   ├── api.ts         # REST API client (thin fetch wrapper)
        │   ├── useResizable.ts    # Mouse-drag panel resizer with localStorage persistence
        │   └── useSuggestions.ts   # @file and /command autocomplete engine
        ├── components/
        │   ├── Sidebar.tsx            # Project list + WS connection indicator
        │   ├── JobList.tsx            # Job cards for selected project
        │   ├── JobDetail.tsx          # Chat view, tool renderers, thinking blocks, subagent nesting
        │   ├── NewJobModal.tsx
        │   ├── NewProjectModal.tsx
        │   ├── ApprovalList.tsx       # Pending AskUserQuestion / plan approvals
        │   ├── CommandPalette.tsx     # Cmd+K fuzzy search across all jobs
        │   └── SuggestionDropdown.tsx # Autocomplete popup for @files and /commands
        └── styles/global.css  # All CSS — custom properties, dark theme
```
- `job.status` describes runtime state. Only `running` and `idle` mean there is a live in-memory execution path.
- `job.mode` describes how the next successful turn should be retained: one-shot `job` vs persistent `session`.
- `job.sessionId` describes whether the SDK gave us a resumable conversation handle.


```bash
# One-click setup (interactive, checks Node ≥18, prompts for API key)
./setup.sh              # dev mode: Vite HMR + Express
./setup.sh --prod       # production: builds client + starts PM2 daemon
./setup.sh --prod --fg  # production: builds client + foreground server (no PM2)
./setup.sh --install    # install deps only, no start
Implementation rules:

# Manual install
cd server && npm install && cd ../client && npm install && cd ..
npm install
- Only show `idle` / `Session Active` when there is a real live session attached for that job.
- `Pin as Session` is for a currently live `idle` job. It should cancel the idle auto-complete timer and keep the current channel alive.
- A completed/failed job with `sessionId` can be resumed, but converting it to session mode should be described as a resume preference unless the backend truly re-attaches a live session immediately.
- A completed/failed job without `sessionId` is not resumable. Prefer explicit UX copy over silently hiding the reason.
- If backend semantics change, update `server/src/index.ts`, `client/src/components/JobDetail.tsx`, and `README.md` in the same change.

# Dev (both server + client with HMR)
npm run dev
# Server: http://localhost:3001
# Client: http://localhost:5173 (Vite, open this)

# Production via PM2 (same as ./setup.sh --prod)
npm start            # builds client + pm2 start (daemon)
npm stop             # pm2 stop
npm restart          # rebuild client + pm2 restart
npm run logs         # pm2 logs
npm run status       # pm2 describe
`/api/jobs/:id/keep-alive` should keep these behaviors distinct:

# Build client only
npm run build:client   # outputs to client/dist/
```

No build step for server — `tsx` executes `.ts` directly. In production, Express serves `client/dist/` as static files. Server restart required on server code changes (no HMR). Client has Vite HMR in dev.

**Production modes**: `./setup.sh --prod` and `npm start` both use PM2 to daemonize the server (auto-restart, log rotation, survives terminal close). Use `./setup.sh --prod --fg` for a foreground process if you need direct stdout/stderr (e.g., debugging, Docker containers).

## Tech Stack

- **Server**: Express 4, ws 8, `@anthropic-ai/claude-agent-sdk`, uuid, cors, tsx (no build)
- **Client**: React 18, Vite 5, lucide-react (icons), no CSS framework
- **Root**: concurrently (dev), pm2 (production)
- **TypeScript**: strict mode in both server and client

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Express server port |
| `PROJECTS_ROOT` | `../projects` (relative to server/) | Root dir for project workspaces |
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key for Claude Agent SDK |
| `ANTHROPIC_BASE_URL` | *(optional)* | Custom API base URL |

## Architecture

### Communication: REST + WebSocket

Vite proxies `/api` → `http://localhost:3001` and `/ws` → `ws://localhost:3001` in dev. In production, Express serves client/dist and all paths from a single port. Client uses only relative paths.

**REST endpoints** (`/api`):
- `GET/POST /projects` — CRUD projects
- `GET/POST /jobs` — list/create jobs; `GET /jobs/:id` returns full logs
- `POST /jobs/:id/continue` — resume session with follow-up prompt
- `POST /jobs/:id/stop` — abort running job
- `POST /jobs/:id/archive` — archive job
- `POST /jobs/:id/unarchive` — restore archived job
- `GET /jobs/:id/commands` — get slash commands from active SDK session
- `GET /projects/:id/files[/*]` — file browser
- `GET /projects/:id/files-search` — fuzzy file-name + content search
- `GET /projects/:id/git/status` — git repo state (branch, staged/unstaged/untracked, ahead/behind, diffs)
- `GET /projects/:id/git/diff` — per-file or all-files diff with stat summary
- `POST /projects/:id/git/action` — execute git actions (add, add_all, commit, push, pull, discard)
- `GET /projects/:id/cron` — list cron/scheduled tasks (merges file-based + session-derived)
- `GET /search` — global fuzzy search across job names, prompts, and log content

**WebSocket events** (server → client):
- `init` — full state on connect (jobs without logs)
- `project:created`, `job:created` — new entities
- `job:updated` — status/metadata changes
- `job:log` — individual log entries (real-time streaming)

### Server: Single-file backend (`server/src/index.ts`)

- In-memory state: `projects[]`, `jobs[]`, `activeQueries` Map
- Persisted to `projects/.state.json` on every mutation (last 200 logs/job)
- On restart: `running` jobs marked as `failed`
- Job runner: async generator from `query()` SDK call; stores handle as `session.queryHandle`
- **Permission system via `canUseTool`** callback (replaces old `bypassPermissions`):
  - `AskUserQuestion` → surfaced to UI, blocks until user responds via REST
  - `ExitPlanMode` → reads plan from SDK input, auto-approves after 5-minute timeout
  - All other tools → auto-allowed with `{ behavior: 'allow', updatedInput: input }`
- **Tool result extraction** (`extractToolResultContent`): tool-aware parsing for Bash (stdout/stderr), Read (structured file info), Glob (filenames), Grep (content/mode), Write/Edit (filePath/type); others fallback to `JSON.stringify` up to 50,000 chars
- **Subagent lifecycle logging**: `task_started`, `task_progress`, `task_notification` events with `parent_tool_use_id` for nesting context
- **Cron merging**: `/api/projects/:id/cron` merges `.claude/scheduled_tasks.json` with session-derived tasks parsed from `CronCreate`/`CronDelete` tool call/result pairs in job logs

### Client: React + custom hooks

- **No state library** — `useStore()` custom hook owns all state via `useState`
- WebSocket auto-reconnects every 2s; guards against duplicate connections (StrictMode-safe)
- `JobDetail` deduplicates REST + WS logs using `timestamp|type|content` key
- **Resizable panels** — sidebar (200–480px) and job list (240–600px) via `useResizable` hook with localStorage persistence
- **Command palette** (Cmd+K) — fuzzy search across all jobs (name, prompt, project, log content) with debounced server search fallback
- **Suggestion dropdown** — `@` triggers file path autocomplete, `/` triggers slash command autocomplete (merges local commands + SDK commands from active session)
- All styles in single `global.css` with CSS custom properties (dark theme, JetBrains Mono + Inter fonts)

## Data Models

```typescript
type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'archived';
type LogType = 'text' | 'tool' | 'system' | 'error' | 'result' | 'thinking';

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
  type: LogType;
  content: string;
  meta?: {
    input?: Record<string, unknown>;
    tool_use_id?: string;
    parent_tool_use_id?: string;    // links child logs to parent Agent tool call
    block_type?: string;
    is_error?: boolean;
    subagent_task_id?: string;
    subagent_status?: 'started' | 'progress' | 'completed' | 'failed';
    subagent_usage?: { input_tokens?: number; output_tokens?: number };
    [key: string]: unknown;
  };
}
```

**Types are manually duplicated** between `server/src/types.ts` and `client/src/types/index.ts`. Keep them in sync.

## JobDetail: Tool Rendering System

The `JobDetail` component groups raw log entries into a chat message timeline via `groupLogsIntoChatMessages()` and renders per-tool specialized bodies:

### Tool-Colored Left Borders
Each tool call block gets a colored left border via `getToolBorderColor(name)`:
- 🟢 Green: `Bash`, `Write`
- 🟡 Amber: `Edit`, `NotebookEdit`
- ⚫ Gray: `Read`, `Grep`, `Glob`, `CronCreate/Delete/List`
- 🔵 Blue: `LSP`, `WebSearch`, `WebFetch`, `AskUserQuestion`, `EnterPlanMode`
- 🟣 Indigo/Violet/Purple: `ExitPlanMode`, `TaskCreate/Update/List`, `TodoWrite`, `Agent`, `Skill`

### Per-Tool Body Renderers
| Component | Tools | Rendering |
|---|---|---|
| `ToolBodyBash` | Bash | Description + command `<pre>` + output `<pre>` |
| `ToolBodyEdit` | Edit | LCS-based unified diff with +/−/space prefixes |
| `ToolBodyReadWrite` | Read, Write, Glob, Grep | File path, line count, content preview (truncated 800 chars) |
| `ToolBodySearch` | Grep, Glob | Pattern/glob display + up to 30 result lines |
| `ToolBodyAgent` | Agent | Prompt + markdown-rendered result (parses SDK content blocks) + metadata footer |
| `ToolBodyTodo` | TodoWrite | Status icons (✓/›/○) list |
| `ToolBodyDefault` | Others | Truncated raw output |

All expanded tool bodies include a **"{ } Raw" toggle** to view raw input/output JSON.

### Thinking Blocks
`ThinkingBlock` component renders `log.type === 'thinking'` entries as collapsible blocks. Collapsed state shows an 80-char preview; expanded shows full text. Consecutive thinking entries are merged.

### Subagent Nesting
`groupLogsIntoChatMessages()` builds a parent–child tree using `parent_tool_use_id`:
- Logs with `meta.parent_tool_use_id` are nested inside the matching parent Agent tool part
- An orphan re-parenting pass handles out-of-order log delivery
- `ToolCallBlock` renders `tool.children` recursively with increasing depth
- Collapsed Agent headers show an "N steps" badge with child tool count

### Agent Result Content Block Parsing
Agent tool results come from the SDK as `[{"type":"text","text":"..."},{"type":"text","text":"agentId:..."}]`. The `parseContentBlocks()` function:
- Detects this array format and separates main content from agent metadata (blocks matching `agentId:` / `total_tokens:`)
- `ToolBodyAgent` renders the main text as markdown and the metadata in a small `tool-agent-meta` footer
- `parseToolResult()` also handles this format in the generic fallback path

## Code Conventions

- **TypeScript strict** — no implicit any; `as any` only for SDK message parsing escape hatches
- **Named exports** for components: `export function JobList(...)`; default export only for `App`
- **Interface Props** pattern: define `interface Props { ... }` above each component
- **ISO 8601 strings** for all timestamps (not Date objects)
- **Server imports** require `.js` extension for ESM: `import type { Job } from './types.js'`
- **Client imports** omit extension: `import type { Job } from '../types'`
- **CSS classes**: kebab-case (`.job-card`, `.badge-running`, `.split-left`)
- **No tests, no linting config** — no ESLint, Prettier, Jest, or CI


## Service Restart
After you finish your change(add feature, fix bug,...), restart the frontend to employ before you finish the task, For change on backend service, never restart the service until user tell you to do so since their maybe other job running.

** Exeception and Required if you are developing at a worktree**: If you are working on a worktree, you should just restart both the frontend and backend for user to test and verify. the main branch service is default serve at http://localhost:5174. You should launch service for worktree use other port(ranging from 6100-6200, backend to 3100-3200) to avoid conflic.


## Code/Plan Review
- **Plan review:** When you finish drafting a plan, invite Codex to review it before submitting to the user for approval.
- **Implementation review:** After implementing a plan you created, always invite Codex to review your implementation before marking the task as complete.
- **Exception:** For small, simple, or self-contained tasks (e.g., a one-line fix, renaming, minor config change), you may skip the Codex review and proceed directly.

## Important Notes

1. **`projects/` dir** is where Claude writes files at runtime — not gitignored by default
2. **Session resume**: `job.sessionId` is passed as `opts.resume` when continuing; "Continue" UI only appears if `sessionId` exists and job is completed/failed
3. **Project name sanitization**: `/[^a-zA-Z0-9_-]/g` → `_` for directory names
4. **File browser security**: path traversal guard via `filePath.startsWith(project.path)`; dotfiles and `node_modules` filtered from listings
5. **Tool result truncation**: logged results capped at 50,000 chars via `extractToolResultContent` (execution not truncated)
6. **CORS wide open**: `cors()` with no config — restrict in production
7. **No auth**: zero authentication — designed for local/trusted network only
8. **React StrictMode** is enabled in dev — WebSocket code must handle double-mount
9. **Production static serving**: Express serves `client/dist/` — after rebuilding (`npm run build:client`), hard-refresh browser to pick up new assets (no server restart needed)
10. **Approval timeouts**: `ExitPlanMode` auto-approves after 5 minutes (`PLAN_APPROVAL_TIMEOUT_MS`); timers cleared on manual response or job expiry
11. **SDK slash commands**: fetched via `session.queryHandle.supportedCommands()` with a `cachedCommands` fallback; client retries up to 3 times (1.5s apart) for session handle readiness


## Claude-Agent-SDK develop ref
You actively look for official doc when develop feature when you need to implement feature/fix bug related to claude-agent-sdk
@https://platform.claude.com/docs/en/agent-sdk/overview
@https://platform.claude.com/docs/en/agent-sdk/agent-loop
@https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
@https://platform.claude.com/docs/en/agent-sdk/streaming-output
