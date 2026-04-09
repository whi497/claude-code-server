# Usage Guide

A complete walkthrough of every feature in Claude Code Server.

## Table of Contents

- [Overview](#overview)
- [Projects](#projects)
- [Jobs](#jobs)
- [Chat View](#chat-view)
- [Sessions & Persistence](#sessions--persistence)
- [Fork & Edit](#fork--edit)
- [Extended Thinking](#extended-thinking)
- [Image Attachments](#image-attachments)
- [Approvals](#approvals)
- [Terminal](#terminal)
- [File Browser](#file-browser)
- [Git Panel](#git-panel)
- [Memories](#memories)
- [Cron Tasks](#cron-tasks)
- [Command Palette](#command-palette)
- [Slash Commands & Autocomplete](#slash-commands--autocomplete)
- [Import Local Sessions](#import-local-sessions)
- [Archiving](#archiving)

---

## Overview

The UI has a three-panel layout:

```
┌──────────┬───────────┬────────────────────────────┐
│          │           │                            │
│ Sidebar  │ Job List  │     Job Detail             │
│(projects)│           │  (Chat/Terminal/Files/Git)  │
│          │           │                            │
└──────────┴───────────┴────────────────────────────┘
```

- **Sidebar** — Lists all projects, shows active jobs, connection status, and approvals
- **Job List** — Shows all jobs for the selected project
- **Job Detail** — The main work area with tabs: Chat, Terminal, Output, Files, Git, Memories, Cron

All three panels are **resizable** — drag the borders to adjust. Sizes are saved in your browser.

---

## Projects

A project is a named workspace with its own directory on the filesystem. Claude's file operations (read, write, execute) are scoped to this directory.

### Create a Project

1. Click the **+** button next to "Projects" in the sidebar
2. Enter a project name
3. (Optional) Check "Use custom path" and enter an absolute filesystem path — useful for pointing Claude at an existing codebase

The project directory is created automatically at `projects/<name>/` unless you specify a custom path.

### Project Context Menu

Right-click a project (or click the **⋯** menu) for options:
- **Archive Project** — Hides the project from the main list (see [Archiving](#archiving))

### Active Jobs in Sidebar

When a project has running or idle jobs, they appear as compact rows under the project name in the sidebar. Each shows:
- A status badge (`run` / `idle`)
- The job name or prompt
- Quick action buttons (Stop, Complete, Close Session)

Double-click a job name in the sidebar to **rename** it inline.

---

## Jobs

A job is a single Claude conversation — a prompt you send plus all of Claude's responses, tool calls, and results.

### Create a Job

1. Select a project in the sidebar
2. Click **New Job**
3. Type your prompt in the text area
4. (Optional) Configure session mode, thinking, or attach images
5. Click **Submit**

Claude immediately begins processing. You'll see real-time output streaming in the Chat tab.

### Job Status Lifecycle

```
queued → running → idle → completed
                     │
                     └──→ failed
```

| Status | Meaning |
|--------|---------|
| `queued` | Job created, waiting to start |
| `running` | Claude is actively processing |
| `idle` | Claude finished a turn, waiting for your follow-up (5-minute grace period for regular jobs) |
| `completed` | Job finished normally |
| `failed` | An error occurred or the job was manually stopped |
| `archived` | Hidden from the main list (can be restored) |

### Sending Follow-up Messages

When a job is **idle** or **completed**, you can send follow-up messages using the input bar at the bottom of the Chat tab. This continues the same Claude session, preserving full context.

When a job is **running**, you can still type a message — it will be **queued** and sent after Claude finishes the current turn. A banner above the input lets you know the message will be queued.

### Renaming Jobs

Double-click the job title in the job list or sidebar to rename it inline. Press Enter to save, Escape to cancel.

---

## Chat View

The Chat tab is the primary interface for interacting with Claude. It renders a rich chat timeline with:

### Message Types

- **Your messages** — Displayed on the left with a "You" label. Shows attachments as badges if present.
- **Claude's responses** — Text rendered as markdown (code blocks, tables, links, headings, lists, etc.)
- **Tool calls** — Each tool Claude uses is displayed as a collapsible block with a color-coded left border:

| Color | Tools |
|-------|-------|
| Green | Bash, Write |
| Amber | Edit, NotebookEdit |
| Gray | Read, Grep, Glob, Cron tools |
| Blue | LSP, WebSearch, WebFetch, AskUserQuestion |
| Indigo/Purple | ExitPlanMode, Agent, Skill, TodoWrite |

### Tool Call Details

Each tool block shows:
- **Header:** Tool name, a one-line summary, and status (spinner while active, "done"/"error" when complete)
- **Body (when expanded):** Tool-specific rendering:
  - **Bash** — Command in a code block + stdout/stderr output
  - **Edit** — Unified diff with green/red highlighting for added/removed lines
  - **Read/Write** — File path, line count, and content preview
  - **Grep/Glob** — Search pattern and results (up to 30 lines)
  - **TodoWrite** — Checklist with ✓ / › / ○ status icons
  - **Agent** — Subagent description, prompt, and result rendered as markdown
- **Raw toggle:** Click `{ } Raw` at the bottom of any tool block to see the raw JSON input and output
- **Fullscreen:** Click the expand button to view long tool outputs in a fullscreen modal

### Thinking Blocks

When extended thinking is enabled, Claude's reasoning appears as collapsible gray blocks. Click to expand/collapse. Consecutive thinking entries are merged.

### Subagent Nesting

When Claude spawns subagents (via the Agent tool), their tool calls appear **nested inside** the parent Agent block. This can recurse multiple levels deep. Collapsed Agent headers show an "N steps" badge.

### Typing Indicator

Three animated dots appear while Claude is actively generating.

---

## Sessions & Persistence

### Regular Jobs vs Sessions

| | Regular Job | Session |
|---|---|---|
| **Behavior after turn** | Enters `idle` state with 5-minute auto-complete timer | Enters `idle` state, stays alive indefinitely |
| **Use case** | One-off tasks, quick questions | Ongoing work, iterative development |
| **Timer** | Countdown shown in header; completes automatically | No timer |

### Starting a Session

When creating a new job, check **"Start as persistent session"** in the New Job modal.

> **Auto-detection:** If Claude creates a scheduled task (cron job) during a regular job, it's automatically promoted to session mode.

### Session Controls

When a job is idle, the header shows contextual buttons:
- **Complete Now** — End the job immediately (skip the 5-minute grace period)
- **Pin as Session** (star icon) — Convert a regular idle job into a persistent session
- **Close Session** — Gracefully end a session-mode job
- **Stop** — Force-stop any running or idle job

For completed or failed jobs, **Convert to Session** lets you reopen the job for continued interaction.

### Resuming After Server Restart

When the server restarts, running jobs are marked as `failed` (since the live process is lost). However, the Claude session file is preserved. You can **continue** a failed job — it resumes the SDK session from where it left off using the saved `sessionId`.

---

## Fork & Edit

Fork lets you create a new conversation that branches from a specific point in an existing chat.

### Fork from an Assistant Turn

After each of Claude's responses, a **Fork** button appears (only for jobs with a session). Click it to:
1. Open the Fork modal
2. Enter a new prompt
3. Submit — this creates a new job that includes the conversation history up to that point, then starts a fresh turn with your new prompt

### Edit & Resend a User Message

Each of your messages has a **pencil icon** (edit button). Clicking it opens the Fork modal pre-filled with your original message. Edit the text and submit to create a new branched conversation from that point.

### Fork Indicators

Forked jobs show a branch icon and a clickable link to the parent job, so you can trace the conversation lineage.

---

## Extended Thinking

Extended thinking gives Claude a dedicated "thinking" step before responding, which can improve quality for complex tasks.

### Configuring Thinking

**At job creation:**
1. In the New Job modal, check **"Extended thinking"**
2. Choose an effort level: **Lo** / **Med** / **Hi**
3. Set a token budget (presets: 10k, 50k, 100k, 200k, or enter a custom value)

**During a conversation:**
The thinking toolbar appears above the chat input bar:
1. Click the **Think** toggle to enable/disable
2. Adjust effort and budget on the fly
3. Changes take effect on the next message

---

## Image Attachments

You can send images to Claude alongside your text prompts.

### Adding Images

Three ways to attach images:
- **Drag & drop** — Drop images anywhere on the input area
- **Paste** — Copy an image and paste (`Ctrl+V` / `Cmd+V`) into the input
- **Browse** — Click the paperclip icon to open a file picker

### Supported Formats

JPEG, PNG, GIF, WebP

### Limits

- Max 10 images per message
- Max 5 MB per image
- Max 20 MB total per message

Attached images appear as thumbnails below the input. Click the **X** on a thumbnail to remove it.

In the chat history, past attachments appear as compact badges (filename + size) since the image data is not stored long-term.

---

## Approvals

When Claude needs your input, the approval system pauses execution and waits for your response.

### Two Types of Approvals

**Questions (AskUserQuestion):**
Claude asks you a question, optionally with predefined answer choices. You can click a choice or type a free-form response. If you don't respond within **10 minutes**, the question is auto-discarded.

**Plan Approval (ExitPlanMode):**
Claude proposes a plan and asks for your approval before executing. You can **Approve** or **Reject** (with an optional reason). If you don't respond within **5 minutes**, the plan is auto-approved.

### Where Approvals Appear

- **Sidebar** — A notification count badge appears when approvals are pending
- **Approvals view** — Click "Approvals" in the sidebar for the full list with details

### Responding

1. Click a pending approval in the sidebar or approvals view
2. For questions: type your answer or click a predefined option
3. For plans: click **Approve** or **Reject**
4. Claude immediately resumes execution

---

## Terminal

The Terminal tab provides a full terminal emulator connected to your project's working directory.

### Features

- Real xterm.js terminal with ANSI color support
- Runs your default shell (from `$SHELL`, typically bash)
- WebSocket PTY — low-latency, responsive input
- Clickable URLs (opens in new tab)
- 10,000-line scrollback buffer
- Auto-resizes with the panel

### Usage

1. Select a project and open any job
2. Click the **Terminal** tab
3. Use it like any terminal — run commands, install packages, inspect files

The terminal session persists across tab switches (it's never unmounted). Each project gets its own terminal. The terminal connects via a separate WebSocket (`/terminal?projectId=...`).

### Controls

- **Status dot** — Green when connected, gray when disconnected
- **Reconnect** — Click to restart the terminal connection
- **Disconnect** — Click to close the PTY session

---

## File Browser

The Files tab lets you explore the project's filesystem.

### Tree View

A collapsible directory tree shows the project's files. The root directory is expanded by default. Directories show a file count badge. Certain directories are hidden automatically (`node_modules`, `.git`, `__pycache__`, `venv`, `dist`, `build`, etc.).

### File Search

Type in the search box to find files by name or content:
- **Name matches** — Fuzzy matching on file paths (scored by consecutive matches and word boundaries)
- **Content matches** — Substring search inside text files (shown with line numbers and context)

Click any file to view its content in the right panel.

### Limits

- File content: max 2 MB per file
- Directory entries: max 200 per directory, 5,000 total
- Content search: skips files larger than 512 KB

---

## Git Panel

The Git tab provides a visual git workflow without leaving the browser.

### What It Shows

- **Branch name** with ahead/behind counts (e.g., `main ↑2 ↓0`)
- **Changed files** grouped by status:
  - **Staged** (ready to commit)
  - **Modified** (unstaged changes)
  - **Untracked** (new files)
- **Diff viewer** — Click a file to see its unified diff with syntax highlighting
- **"Touched by this job" indicators** — Files that Claude read, wrote, or edited in the current job are marked with a star

### Actions

| Button | What it does |
|--------|-------------|
| **Stage** | `git add <file>` |
| **Stage All** | `git add -A` |
| **Unstage** | `git reset HEAD <file>` |
| **Discard** | `git checkout -- <file>` (irreversible!) |
| **Commit** | `git commit -m "message"` |
| **Push** | `git push` |
| **Pull** | `git pull` |
| **Refresh** | Re-fetch git status |

### Committing

1. Stage your changes (individually or "Stage All")
2. Type a commit message in the input bar at the bottom
3. Press Enter or click **Commit**
4. Click **Push** to push to the remote

---

## Memories

The Memories tab lets you view and edit Claude's memory files — the `CLAUDE.md` hierarchy that provides persistent instructions.

### Memory Hierarchy

The tab shows all memory sources in Claude's priority order:

| Level | Description | Editable |
|-------|-------------|----------|
| **User Instructions** | `~/.claude/CLAUDE.md` — Your global instructions for all projects | Yes |
| **User Rules** | `~/.claude/rules/*.md` — Global rule files | Yes |
| **Project Instructions** | `<project>/CLAUDE.md` — Project-specific instructions | Yes |
| **Project .claude/** | `<project>/.claude/CLAUDE.md` — Alternative project instructions | Yes |
| **Local Instructions** | `<project>/CLAUDE.local.md` — Local-only instructions (not committed) | Yes |
| **Project Rules** | `<project>/.claude/rules/*.md` — Project rule files | Yes |
| **Auto Memory** | `~/.claude/projects/<path>/memory/` — Auto-generated memories | Read-only |

### Editing

1. Click a memory file in the left sidebar
2. Click **Edit** in the top-right
3. Make your changes in the text area
4. Click **Save**

The file is created automatically if it doesn't exist yet.

---

## Cron Tasks

The Cron tab shows all scheduled tasks that Claude has created during the session.

Each task displays:
- **Cron expression** (e.g., `*/5 * * * *`)
- **Type badge** — `once` (one-shot) or `recurring`
- **Durable badge** — Whether it persists across server restarts
- **Session badge** — Whether it's tied to the current session
- **Prompt** — What Claude runs on each execution
- **Last/next run timestamps**

Tasks come from two sources:
- **Durable tasks** — Saved in `.claude/scheduled_tasks.json`
- **Session tasks** — Reconstructed from CronCreate/CronDelete tool calls in job logs

---

## Command Palette

Press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to open the command palette — a global fuzzy search across all your jobs.

### What It Searches

- Job names
- Prompts
- Project names
- Chat log content (via server-side search)

### Usage

1. Press `Cmd+K`
2. Start typing — results appear instantly
3. Use arrow keys to navigate, Enter to open a job
4. Press Escape to close

When the search box is empty, it shows your most recent jobs.

---

## Slash Commands & Autocomplete

### Slash Commands (`/`)

Type `/` at the start of the input (or after a space) to see available commands:

**Local commands:**
- `/session` — Toggle session mode on/off

**Claude Code commands** (sent to the active session):
- `/compact` — Compact conversation context
- `/model` — Switch Claude model
- `/memory` — View memory files
- `/config` — View configuration
- `/review` — Code review
- `/pr-comments` — PR comment review
- `/cost` — View session cost
- `/permissions` — View permissions
- `/mcp` — MCP server info
- `/context` — Context management
- `/bug` — Report a bug
- And more, depending on your Claude Code installation

### File Autocomplete (`@`)

Type `@` anywhere in the input to get file path suggestions from the current project. The autocomplete:
- Shows files from the project directory
- Fuzzy-matches as you type
- Debounces server calls for performance

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate suggestions |
| `Enter` / `Tab` | Select suggestion |
| `Escape` | Dismiss dropdown |

---

## Import Local Sessions

If you've used the Claude Code CLI before, you can import your past sessions into the web UI.

### How to Import

1. Click the **Import** button (download icon) in the sidebar's Projects section
2. The import modal discovers all sessions in `~/.claude/projects/`
3. Browse projects, expand to see individual sessions
4. Select the sessions you want to import
5. Click **Import Selected**

### What Gets Imported

For each session:
- A project is created (or reused if one already exists for that path)
- A job is created with `completed` status
- Up to 50 log entries are imported from the JSONL file
- Token usage is calculated from the session data
- The original session ID is preserved (so you can resume it)

### Deduplication

Sessions that have already been imported are marked with a green "✓ imported" badge and can't be re-selected. Detection is based on matching session IDs or matching prompt + creation date.

### Search & Filter

Use the search bar in the import modal to filter by project path, project name, session name, or prompt content.

---

## Archiving

Keep your workspace tidy by archiving projects and jobs you're done with.

### Archive a Project

Right-click a project → **Archive Project**. This:
- Stops all running/idle jobs in the project
- Moves the project to the "Archived Projects" section at the bottom of the sidebar

### Archive a Job

Click the **Archive** button in the job detail header. Running/idle jobs are stopped first.

### Restore

- **Projects:** Click the restore icon on an archived project
- **Jobs:** Click "Archived Jobs" at the bottom of the job list, then click the restore icon on any job

Archived items are hidden from the main views but not deleted. All data is preserved.
