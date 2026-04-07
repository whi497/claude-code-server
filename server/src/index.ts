import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRequire } from 'module';
import type { Job, Project, LogEntry, JobStatus } from './types.js';

// Resolve the SDK's built-in CLI path at startup (before cwd changes)
const require = createRequire(import.meta.url);
const CLAUDE_CLI_PATH = path.join(
  path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),
  'cli.js'
);

// ── Config ──────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3001);
const PROJECTS_ROOT = path.resolve(process.env.PROJECTS_ROOT ?? path.join(process.cwd(), '..', 'projects'));
const STATE_FILE = path.join(PROJECTS_ROOT, '.state.json');

// ── In-memory state (persisted to disk) ─────────────────────────
let projects: Project[] = [];
let jobs: Job[] = [];
const activeQueries = new Map<string, { abort: AbortController }>();

function saveState() {
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ projects, jobs: jobs.map(j => ({ ...j, logs: j.logs.slice(-200) })) }, null, 2));
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      projects = data.projects ?? [];
      jobs = (data.jobs ?? []).map((j: Job) => ({
        ...j,
        // Mark previously running jobs as failed on restart
        status: j.status === 'running' ? 'failed' as JobStatus : j.status,
      }));
    }
  } catch { /* start fresh */ }
}

// ── WebSocket broadcast ─────────────────────────────────────────
const wsClients = new Set<WebSocket>();

function broadcast(event: string, data: unknown) {
  const msg = JSON.stringify({ event, data });
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ── Agent SDK job runner ────────────────────────────────────────
async function runJob(job: Job) {
  const project = projects.find(p => p.id === job.projectId);
  if (!project) {
    job.status = 'failed';
    job.error = 'Project not found';
    job.updatedAt = new Date().toISOString();
    broadcast('job:updated', job);
    saveState();
    return;
  }

  const cwd = project.path;
  fs.mkdirSync(cwd, { recursive: true });

  job.status = 'running';
  job.updatedAt = new Date().toISOString();
  broadcast('job:updated', job);
  saveState();

  const abortController = new AbortController();
  activeQueries.set(job.id, { abort: abortController });

  const addLog = (entry: Omit<LogEntry, 'timestamp'>) => {
    const log: LogEntry = { ...entry, timestamp: new Date().toISOString() };
    job.logs.push(log);
    broadcast('job:log', { jobId: job.id, log });
  };

  try {
    const opts: Parameters<typeof query>[0]['options'] = {
      cwd,
      abortController,
      pathToClaudeCodeExecutable: CLAUDE_CLI_PATH,
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'],
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: false,
      thinking: { type: 'disabled' },
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'IMPORTANT: You are running in a non-interactive batch server environment. There is NO human operator to interact with. You MUST NOT use AskUserQuestion, EnterPlanMode, or ExitPlanMode tools — they are unavailable. Instead, make reasonable decisions autonomously and proceed with execution directly. If the task is ambiguous, choose the most sensible interpretation and explain your reasoning in your response.',
      },
    };

    // Resume session if available
    if (job.sessionId) {
      (opts as any).resume = job.sessionId;
    }

    addLog({ type: 'system', content: `Starting job in ${cwd}` });

    for await (const message of query({ prompt: job.prompt, options: opts })) {
      const msg = message as any;

      // Capture session ID from init
      if (msg.type === 'system' && msg.subtype === 'init') {
        job.sessionId = msg.session_id;
        addLog({ type: 'system', content: `Session: ${msg.session_id} | Model: ${msg.model}` });
      }

      // Assistant messages
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            addLog({ type: 'text', content: block.text });
          } else if (block.type === 'tool_use') {
            addLog({
              type: 'tool',
              content: `🔧 ${block.name}`,
              meta: { input: block.input },
            });
          }
        }
      }

      // Tool results (user messages with tool results)
      if (msg.type === 'user' && msg.tool_use_result !== undefined) {
        const resultStr = typeof msg.tool_use_result === 'string'
          ? msg.tool_use_result
          : JSON.stringify(msg.tool_use_result).slice(0, 2000);
        addLog({ type: 'tool_result', content: resultStr, meta: { tool_use_id: msg.tool_use_id } });
      }

      // Final result
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          job.status = 'completed';
          job.result = msg.result;
          job.costUsd = msg.total_cost_usd;
          job.tokenUsage = {
            input: msg.usage?.input_tokens ?? 0,
            output: msg.usage?.output_tokens ?? 0,
          };
          addLog({ type: 'result', content: msg.result ?? 'Done' });
        } else {
          job.status = 'failed';
          job.error = msg.errors?.join('; ') ?? msg.subtype;
          addLog({ type: 'error', content: job.error! });
        }
      }

      job.updatedAt = new Date().toISOString();
      broadcast('job:updated', job);
    }
  } catch (err: any) {
    job.status = 'failed';
    job.error = err.message ?? String(err);
    addLog({ type: 'error', content: job.error! });
  } finally {
    activeQueries.delete(job.id);
    job.updatedAt = new Date().toISOString();
    broadcast('job:updated', job);
    saveState();
  }
}

// ── Express app ─────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Projects CRUD
app.get('/api/projects', (_req, res) => res.json(projects));

app.post('/api/projects', (req, res) => {
  const { name, path: customPath } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuid();
  const projectPath = customPath
    ? path.resolve(customPath)
    : path.join(PROJECTS_ROOT, name.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const project: Project = {
    id,
    name,
    path: projectPath,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(project.path, { recursive: true });
  projects.push(project);
  saveState();
  broadcast('project:created', project);
  res.status(201).json(project);
});

app.delete('/api/projects/:id', (req, res) => {
  projects = projects.filter(p => p.id !== req.params.id);
  saveState();
  res.json({ ok: true });
});

// Jobs CRUD
app.get('/api/jobs', (req, res) => {
  const { projectId } = req.query;
  const filtered = projectId ? jobs.filter(j => j.projectId === projectId) : jobs;
  // Return jobs without full logs for list view
  res.json(filtered.map(j => ({ ...j, logs: [] })));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.post('/api/jobs', (req, res) => {
  const { projectId, prompt } = req.body;
  if (!projectId || !prompt) return res.status(400).json({ error: 'projectId and prompt required' });
  if (!projects.find(p => p.id === projectId)) return res.status(404).json({ error: 'project not found' });

  const job: Job = {
    id: uuid(),
    projectId,
    prompt,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
  };
  jobs.push(job);
  saveState();
  broadcast('job:created', job);

  // Start immediately
  runJob(job);

  res.status(201).json(job);
});

// Resume a completed/failed job with a follow-up prompt
app.post('/api/jobs/:id/continue', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status === 'running') return res.status(409).json({ error: 'already running' });

  const { prompt } = req.body;
  // Reset existing job for continuation (no duplicate)
  job.prompt = prompt ?? 'Continue from where you left off.';
  job.status = 'queued';
  job.result = undefined;
  job.error = undefined;
  job.costUsd = undefined;
  job.tokenUsage = undefined;
  job.updatedAt = new Date().toISOString();
  // Keep existing logs — append a separator
  job.logs.push({ type: 'system', content: '── Continue ──', timestamp: new Date().toISOString() });
  saveState();
  broadcast('job:updated', job);
  runJob(job);
  res.status(200).json(job);
});

// Archive a job
app.post('/api/jobs/:id/archive', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status === 'running') {
    const q = activeQueries.get(job.id);
    if (q) q.abort.abort();
  }
  job.status = 'archived';
  job.updatedAt = new Date().toISOString();
  saveState();
  broadcast('job:updated', job);
  res.json(job);
});

// Stop a running job
app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  const q = activeQueries.get(job.id);
  if (q) {
    q.abort.abort();
    job.status = 'failed';
    job.error = 'Manually stopped';
    job.updatedAt = new Date().toISOString();
    saveState();
    broadcast('job:updated', job);
  }
  res.json(job);
});

// File browser for project
app.get('/api/projects/:id/files', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  try {
    const listDir = (dir: string, depth = 0): any[] => {
      if (depth > 3) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => ({
          name: e.name,
          path: path.relative(project.path, path.join(dir, e.name)),
          isDir: e.isDirectory(),
          children: e.isDirectory() ? listDir(path.join(dir, e.name), depth + 1) : undefined,
        }));
    };
    res.json(listDir(project.path));
  } catch {
    res.json([]);
  }
});

app.get('/api/projects/:id/files/*', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const filePath = path.join(project.path, (req.params as any)[0]);
  if (!filePath.startsWith(project.path)) return res.status(403).json({ error: 'forbidden' });
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content, path: (req.params as any)[0] });
  } catch {
    res.status(404).json({ error: 'file not found' });
  }
});

// ── HTTP + WebSocket server ─────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  // Send current state on connect
  ws.send(JSON.stringify({ event: 'init', data: { projects, jobs: jobs.map(j => ({ ...j, logs: [] })) } }));
});

loadState();

server.listen(PORT, () => {
  console.log(`🚀 Claude Code Server running on http://localhost:${PORT}`);
  console.log(`📁 Projects root: ${PROJECTS_ROOT}`);
});
