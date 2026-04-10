# API Reference

Claude Code Server exposes a REST API over HTTP and two WebSocket endpoints. All REST endpoints are prefixed with `/api`. The server accepts JSON request bodies (up to 20 MB).

## Table of Contents

- [Projects](#projects)
- [Jobs](#jobs)
- [Approvals](#approvals)
- [File Browser](#file-browser)
- [Git](#git)
- [Memories](#memories)
- [Cron Tasks](#cron-tasks)
- [Search](#search)
- [Import](#import)
- [WebSocket: Control](#websocket-control)
- [WebSocket: Terminal](#websocket-terminal)

---

## Projects

### List Projects

```
GET /api/projects
```

Returns all projects (including archived ones).

**Response:** `Project[]`

### Create Project

```
POST /api/projects
```

**Body:**
```json
{
  "name": "my-project",
  "path": "/optional/absolute/path"
}
```

- `name` (required) — Project name. Sanitized for filesystem use (`[^a-zA-Z0-9_-]` → `_`).
- `path` (optional) — Absolute path to use as the project directory. If omitted, a directory is created at `PROJECTS_ROOT/<sanitized-name>`.

**Response (201):** `Project`

### Delete Project

```
DELETE /api/projects/:id
```

Removes the project from the registry. **Does not delete files on disk.**

**Response:** `{ "ok": true }`

### Archive Project

```
POST /api/projects/:id/archive
```

Archives the project. Stops all running/idle jobs first. Sets `archived: true`.

**Response:** Updated `Project`

### Unarchive Project

```
POST /api/projects/:id/unarchive
```

Restores an archived project.

**Response:** Updated `Project`

---

## Jobs

### List Jobs

```
GET /api/jobs?projectId=<id>
```

- `projectId` (optional) — Filter by project.

Returns all jobs. **Logs are omitted** (empty array) for performance.

**Response:** `Job[]`

### Get Job

```
GET /api/jobs/:id
```

Returns a single job with **full logs**.

**Response:** `Job`

### Create Job

```
POST /api/jobs
```

Creates and immediately starts a new job.

**Body:**
```json
{
  "projectId": "uuid",
  "prompt": "Build a REST API for a todo app",
  "mode": "job",
  "thinking": {
    "type": "enabled",
    "budgetTokens": 10000,
    "effort": "medium"
  },
  "attachments": [
    {
      "id": "uuid",
      "filename": "screenshot.png",
      "mediaType": "image/png",
      "size": 45000,
      "data": "<base64>"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `projectId` | Yes | Target project ID |
| `prompt` | Yes | The prompt to send to Claude |
| `mode` | No | `"job"` (default, 5-min idle auto-complete) or `"session"` (stays alive) |
| `thinking` | No | Extended thinking config. `type: "disabled"` or `type: "enabled"` with `budgetTokens` (8,000–200,000) and optional `effort` (`"low"`, `"medium"`, `"high"`) |
| `attachments` | No | Array of image attachments. Max 10 files, 5 MB each, 20 MB total. Supported types: `image/jpeg`, `image/png`, `image/gif`, `image/webp` |

**Response (201):** `Job`

### Rename Job

```
PATCH /api/jobs/:id
```

**Body:** `{ "name": "new name" }` (pass `null` or empty string to clear)

**Response:** Updated `Job`

### Update Thinking Config

```
PUT /api/jobs/:id/thinking
```

**Body:** `{ "thinking": { "type": "enabled", "budgetTokens": 50000, "effort": "high" } }` or `{ "thinking": null }`

**Response:** Updated `Job`

### Continue / Send Follow-up

```
POST /api/jobs/:id/continue
```

Sends a follow-up message to an existing job. Behavior depends on state:
- **`idle`** — Injects message immediately; clears idle timer
- **`running`** — Queues message for after current turn
- **`completed` / `failed`** — Resets job and re-runs with SDK session resume

**Body:**
```json
{
  "prompt": "Now add authentication",
  "thinking": { "type": "enabled", "budgetTokens": 10000 },
  "attachments": []
}
```

`prompt` defaults to `"Continue from where you left off."` if omitted.

**Response (200):** Updated `Job`

### Fork Job

```
POST /api/jobs/:id/fork
```

Creates a new job branching from a specific point in the conversation.

**Body:**
```json
{
  "prompt": "Try a different approach using Redis",
  "forkPoint": {
    "type": "after_assistant",
    "turnIndex": 2
  }
}
```

| Field | Description |
|-------|-------------|
| `forkPoint.type` | `"after_assistant"` — Fork after the Nth assistant turn. `"edit_user"` — Fork replacing the Nth user message. |
| `forkPoint.turnIndex` | 0-based turn index |

**Constraints:** Cannot fork a `running` or `idle` job (session file is being written). The source job must have a `sessionId`.

**Response (201):** New `Job`

### Stop Job

```
POST /api/jobs/:id/stop
```

Immediately stops a running or idle job. Marks status as `failed` with error `"Manually stopped"`.

**Response:** Updated `Job`

### Close Session

```
POST /api/jobs/:id/close-session
```

Gracefully closes a session-mode or idle job's channel.

**Constraints:** Only works on `mode === 'session'` or `status === 'idle'` jobs.

**Response:** Updated `Job`

### Keep Alive / Convert to Session

```
POST /api/jobs/:id/keep-alive
```

Converts a job to session mode (cancels idle timer, sets `mode: 'session'`).

**Allowed states:** `idle`, `completed`, `failed`

**Response:** Updated `Job`

### Complete Now

```
POST /api/jobs/:id/complete-now
```

Immediately completes an idle job (skips remaining grace period).

**Constraints:** Only works on `status === 'idle'` jobs.

**Response:** Updated `Job`

### Archive Job

```
POST /api/jobs/:id/archive
```

Archives a job. Stops it first if running/idle.

**Response:** Updated `Job`

### Unarchive Job

```
POST /api/jobs/:id/unarchive
```

Restores an archived job.

**Response:** Updated `Job`

### Get Slash Commands

```
GET /api/jobs/:id/commands
```

Returns available slash commands from the active SDK session.

**Response:** `Array<{ name: string, description: string, argumentHint: string }>`

---

## Approvals

### List Approvals

```
GET /api/approvals?status=<status>&jobId=<id>
```

Both query params are optional. Returns newest first.

**Response:** `ApprovalRequest[]`

### Respond to Approval

```
POST /api/approvals/:id/respond
```

**Body:**
```json
{
  "action": "answer",
  "text": "Use PostgreSQL for the database"
}
```

| Action | For Type | Description |
|--------|----------|-------------|
| `answer` | `question` | Answer an AskUserQuestion. `text` is required. |
| `approve` | `plan_exit` | Approve Claude's proposed plan. |
| `reject` | Both | Reject with optional `text` explaining why. |

**Response:** `{ "success": true }`

---

## File Browser

### List Project Files

```
GET /api/projects/:id/files
```

Returns a recursive directory tree (max 3 levels deep). Excludes hidden files and common non-essential directories (`node_modules`, `.git`, `__pycache__`, `dist`, `build`, etc.).

**Response:** `FileNode[]` — Each node has `{ name, path, isDir, children? }`

### Read File Content

```
GET /api/projects/:id/files/<relative-path>
```

Returns the content of a specific file.

**Constraints:** Max file size 2 MB. Path must resolve inside the project root (no path traversal).

**Response:** `{ "content": "file text...", "path": "src/index.ts" }`

### Search Files

```
GET /api/projects/:id/files-search?q=<query>&limit=50&content=true
```

| Param | Default | Description |
|-------|---------|-------------|
| `q` | (required) | Search query (case-insensitive) |
| `limit` | 50 | Max results (max 200) |
| `content` | `true` | Also search file content (not just names) |

**Response:**
```json
{
  "files": [{ "name": "index.ts", "path": "src/index.ts", "isDir": false }],
  "contentMatches": [{ "path": "src/index.ts", "line": 42, "text": "...matching line..." }]
}
```

---

## Git

All git operations run in the project's working directory with a 30-second timeout.

### Get Git Status

```
GET /api/projects/:id/git/status
```

**Response (non-git repo):** `{ "isGitRepo": false }`

**Response (git repo):**
```json
{
  "isGitRepo": true,
  "branch": "main",
  "ahead": 2,
  "behind": 0,
  "staged": [{ "path": "src/foo.ts", "status": "M" }],
  "unstaged": [{ "path": "src/bar.ts", "status": "M" }],
  "untracked": ["newfile.txt"],
  "diff": "<unified diff>",
  "diffCached": "<staged diff>"
}
```

### Get Git Diff

```
GET /api/projects/:id/git/diff?file=<path>&staged=<bool>
```

| Param | Description |
|-------|-------------|
| `file` | Optional — specific file path |
| `staged` | `true` for staged diff (`--cached`), omit for working tree |

**Response:**
```json
{
  "diff": "<unified diff>",
  "stat": "<diff stat summary>",
  "files": [{ "additions": 5, "deletions": 2, "path": "src/foo.ts" }]
}
```

### Execute Git Action

```
POST /api/projects/:id/git/action
```

**Body:**
```json
{
  "action": "commit",
  "message": "Add authentication system",
  "files": ["src/auth.ts"]
}
```

| Action | Required Fields | Git Command |
|--------|----------------|-------------|
| `add` | `files` | `git add <files...>` |
| `add_all` | — | `git add -A` |
| `commit` | `message` | `git commit -m <message>` |
| `push` | — | `git push` |
| `pull` | — | `git pull` |
| `discard` | `files` | `git checkout -- <files...>` |

**Response:** `{ "ok": true, "output": "..." }` or `{ "ok": false, "error": "...", "output": "..." }` (HTTP 422)

---

## Memories

### Get Memory Files

```
GET /api/projects/:id/memories
```

Returns all memory sources in Claude's hierarchy.

**Response:**
```json
{
  "sections": [
    {
      "level": "user",
      "label": "User Instructions",
      "path": "/home/user/.claude/CLAUDE.md",
      "content": "file content or null",
      "editable": true
    }
  ]
}
```

### Save Memory File

```
PUT /api/projects/:id/memories
```

**Body:**
```json
{
  "filePath": "/absolute/path/to/CLAUDE.md",
  "content": "# My Instructions\n..."
}
```

**Constraints:** `filePath` must resolve inside `~/.claude/` or the project directory.

**Response:** `{ "ok": true, "path": "..." }`

---

## Cron Tasks

### Get Scheduled Tasks

```
GET /api/projects/:id/cron?jobId=<id>
```

Returns merged cron tasks from:
1. Durable tasks in `<project>/.claude/scheduled_tasks.json`
2. Session-derived tasks reconstructed from CronCreate/CronDelete tool calls in job logs

**Response:**
```json
{
  "path": "/path/to/.claude/scheduled_tasks.json",
  "tasks": [
    {
      "id": "task-uuid",
      "cron": "*/5 * * * *",
      "prompt": "Check for errors",
      "recurring": true,
      "durable": true,
      "createdAt": "2024-01-01T00:00:00Z",
      "source": "file"
    }
  ]
}
```

---

## Search

### Global Search

```
GET /api/search?q=<query>&limit=50&logs=true
```

Fuzzy search across all non-archived jobs.

| Param | Default | Description |
|-------|---------|-------------|
| `q` | (required) | Search query |
| `limit` | 50 | Max results (max 200) |
| `logs` | `true` | Also search log content |

**Response:**
```json
[
  {
    "jobId": "uuid",
    "projectId": "uuid",
    "jobName": "API server",
    "prompt": "Build a REST API",
    "status": "completed",
    "matchField": "name",
    "matchPreview": "...highlighted match...",
    "score": 550
  }
]
```

---

## Import

### Discover Local Sessions

```
GET /api/import/discover?query=<string>&refresh=<bool>
```

Scans `~/.claude/projects/` for past Claude Code CLI sessions.

| Param | Description |
|-------|-------------|
| `query` | Optional filter (matches path, name, slug, prompt, session ID) |
| `refresh` | `true` to bypass the 60-second cache |

**Response:** `LocalProject[]` — Each contains `sessions: LocalSession[]` with metadata.

### Import Sessions

```
POST /api/import/projects
```

**Body:**
```json
{
  "selections": [
    {
      "dirName": "-mnt-projects-my-app",
      "sessions": ["abc123-def456.jsonl", "789ghi-jkl012.jsonl"]
    }
  ]
}
```

Returns immediately with an import ID. Progress is streamed via WebSocket.

**Response:** `{ "importId": "uuid" }`

---

## WebSocket: Control

```
ws://host/ws
```

Used for real-time state synchronization. Connect from the browser to receive live updates. This is a **receive-only** channel (client does not send messages).

### Events (Server → Client)

| Event | Payload | Description |
|-------|---------|-------------|
| `init` | `{ projects, jobs, approvals }` | Full state on connection (jobs have empty logs) |
| `project:created` | `Project` | New project added |
| `project:updated` | `Project` | Project metadata changed |
| `job:created` | `Job` | New job created |
| `job:updated` | `Job` | Job status/metadata changed |
| `job:log` | `{ jobId, log: LogEntry }` | New log entry streamed |
| `approval:created` | `ApprovalRequest` | Claude needs human input |
| `approval:updated` | `ApprovalRequest` | Approval resolved |
| `import:progress` | `ImportProgress` | Import operation progress update |
| `import:complete` | `ImportResult` | Import finished |

---

## WebSocket: Terminal

```
ws://host/terminal?projectId=<id>
```

Opens a PTY terminal session in the project's working directory. Each connection spawns a new shell process.

### Messages (Server → Client)

| Type | Payload | Description |
|------|---------|-------------|
| `output` | `{ type: "output", data: string }` | Raw terminal output (includes ANSI escape codes) |
| `exit` | `{ type: "exit", code: number }` | Shell process exited |
| `error` | `{ type: "error", data: string }` | Connection or spawn error |

### Messages (Client → Server)

| Type | Payload | Description |
|------|---------|-------------|
| `input` | `{ type: "input", data: string }` | Keystrokes to write to the PTY |
| `resize` | `{ type: "resize", cols: number, rows: number }` | Terminal resize event |

---

## Type Definitions

### Project

```typescript
interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;        // ISO 8601
  archived?: boolean;
  archivedAt?: string;
  importedFrom?: 'local';
}
```

### Job

```typescript
type JobStatus = 'queued' | 'running' | 'idle' | 'completed' | 'failed' | 'archived';

interface Job {
  id: string;
  projectId: string;
  name?: string;
  prompt: string;
  attachments?: Attachment[];
  status: JobStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string;
  result?: string;
  error?: string;
  costUsd?: number;
  tokenUsage?: { input: number; output: number };
  mode?: 'job' | 'session';
  thinking?: ThinkingConfig;
  idleDeadline?: string;
  forkedFrom?: { jobId: string; turnIndex: number };
  logs: LogEntry[];
}
```

### LogEntry

```typescript
type LogType = 'text' | 'tool' | 'tool_result' | 'system' | 'error' | 'result' | 'thinking' | 'user';

interface LogEntry {
  timestamp: string;
  type: LogType;
  content: string;
  meta?: {
    input?: Record<string, unknown>;
    tool_use_id?: string;
    parent_tool_use_id?: string;
    block_type?: string;
    is_error?: boolean;
    subagent_task_id?: string;
    subagent_status?: 'started' | 'progress' | 'completed' | 'failed';
    [key: string]: unknown;
  };
}
```

### ApprovalRequest

```typescript
type ApprovalType = 'question' | 'plan_exit';
type ApprovalStatus = 'pending' | 'answered' | 'approved' | 'rejected' | 'expired' | 'discarded';

interface ApprovalRequest {
  id: string;
  jobId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  content: string;
  options?: Array<{ label: string; description?: string }>;
  response?: string;
  createdAt: string;
  respondedAt?: string;
}
```

### Attachment

```typescript
type AttachmentMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

interface Attachment {
  id: string;
  filename: string;
  mediaType: AttachmentMediaType;
  size: number;
  data: string;  // base64
}
```

### ThinkingConfig

```typescript
type EffortLevel = 'low' | 'medium' | 'high';

type ThinkingConfig =
  | { type: 'disabled' }
  | { type: 'enabled'; budgetTokens: number; effort?: EffortLevel };
```
