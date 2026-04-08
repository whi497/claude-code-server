import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRequire } from 'module';
import type { Job, Project, LogEntry, JobStatus, ApprovalRequest, ApprovalResponse, ApprovalType } from './types.js';

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
const activeQueries = new Map<string, {
  abort: AbortController;
  channel?: { push: (msg: any) => void; close: () => void };
  queryHandle?: any;  // Query object for supportedCommands() etc.
  cachedCommands?: { name: string; description: string; argumentHint: string }[];
}>();

// ── Approval state (ephemeral — not persisted) ──────────────────
const approvals: ApprovalRequest[] = [];
const pendingResolvers = new Map<string, (result: any) => void>();
const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Auto-approve timeout for plan_exit approvals (in ms)
const PLAN_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
        // Mark previously running/idle jobs as failed on restart (sessions lost)
        status: (j.status === 'running' || j.status === 'idle') ? 'failed' as JobStatus : j.status,
        error: (j.status === 'running' || j.status === 'idle') ? (j.error ?? 'Server restarted — session lost') : j.error,
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

// ── Approval helpers ────────────────────────────────────────────
function jobAddLog(jobId: string, entry: Omit<LogEntry, 'timestamp'>) {
  const job = jobs.find(j => j.id === jobId);
  if (!job) return;
  const log: LogEntry = { ...entry, timestamp: new Date().toISOString() };
  job.logs.push(log);
  broadcast('job:log', { jobId, log });
}

// Create a canUseTool callback that intercepts AskUserQuestion and ExitPlanMode.
// canUseTool is the correct SDK mechanism — it pauses the agent until we return.
// Returns a PermissionResult: { behavior: 'allow', updatedInput? } | { behavior: 'deny', message }
function createCanUseTool(jobId: string, projectId: string) {
  return async (toolName: string, input: Record<string, unknown>, _options: any): Promise<any> => {
    console.log(`[canUseTool] ${toolName} for job ${jobId}`);

    // AskUserQuestion: intercept, surface to UI, wait for user answer
    if (toolName === 'AskUserQuestion') {
      const questions = (input.questions as any[]) ?? [];
      const firstQ = questions[0];
      const content = firstQ?.question ?? JSON.stringify(input);
      const options = Array.isArray(firstQ?.options) ? firstQ.options : undefined;

      const approval: ApprovalRequest = {
        id: uuid(), jobId, projectId, type: 'question', status: 'pending',
        content, toolInput: input, options,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      approvals.push(approval);
      broadcast('approval:created', approval);
      jobAddLog(jobId, {
        type: 'system',
        content: `⏳ Claude is asking: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`,
        meta: { approvalId: approval.id },
      });

      // Block until user responds via REST
      return new Promise<any>((resolve) => {
        pendingResolvers.set(approval.id, resolve);
      });
    }

    // ExitPlanMode: intercept, show plan for approval (auto-approves after timeout)
    // The SDK passes `input.plan` (full markdown) and `input.planFilePath` directly.
    if (toolName === 'ExitPlanMode') {
      const planMarkdown = typeof input.plan === 'string' ? input.plan : '';
      const planFilePath = typeof input.planFilePath === 'string' ? input.planFilePath : '';
      const content = planMarkdown
        || 'Claude has finished planning and wants to begin execution.';

      if (planMarkdown) {
        console.log(`[ExitPlanMode] Plan from input.plan (${planMarkdown.length} chars), file: ${planFilePath || 'N/A'}`);
      } else {
        console.warn(`[ExitPlanMode] No plan text in input, using fallback message`);
      }

      const approval: ApprovalRequest = {
        id: uuid(), jobId, projectId, type: 'plan_exit', status: 'pending',
        content, toolInput: input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      approvals.push(approval);
      broadcast('approval:created', approval);
      const timeoutMin = Math.round(PLAN_APPROVAL_TIMEOUT_MS / 60000);
      jobAddLog(jobId, {
        type: 'system',
        content: `⏳ Claude has finished planning and is requesting approval to proceed (auto-approves in ${timeoutMin}min if no response)`,
        meta: { approvalId: approval.id },
      });

      // Set up auto-approve timer
      const timer = setTimeout(() => {
        approvalTimers.delete(approval.id);
        if (approval.status !== 'pending') return; // already resolved
        console.log(`[auto-approve] Plan approval ${approval.id} timed out after ${timeoutMin}min — auto-approving`);
        try {
          resolveApproval(approval.id, { action: 'approve', text: `Auto-approved after ${timeoutMin}min timeout` });
          jobAddLog(jobId, {
            type: 'system',
            content: `✅ Plan auto-approved after ${timeoutMin}min timeout (no human response)`,
            meta: { approvalId: approval.id },
          });
        } catch (err: any) {
          console.error(`[auto-approve] Failed to auto-approve ${approval.id}:`, err.message);
        }
      }, PLAN_APPROVAL_TIMEOUT_MS);
      approvalTimers.set(approval.id, timer);

      return new Promise<any>((resolve) => {
        pendingResolvers.set(approval.id, resolve);
      });
    }

    // All other tools: auto-allow with original input echoed back
    return { behavior: 'allow', updatedInput: input };
  };
}

function resolveApproval(id: string, response: ApprovalResponse) {
  const approval = approvals.find(a => a.id === id);
  if (!approval || approval.status !== 'pending') throw new Error('Approval not found or already resolved');

  const resolver = pendingResolvers.get(id);
  if (!resolver) throw new Error('No pending resolver for this approval');

  // Clear auto-approve timer if it exists (manual response came before timeout)
  const timer = approvalTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    approvalTimers.delete(id);
  }

  const now = new Date().toISOString();
  approval.response = response.text;
  approval.respondedAt = now;
  approval.updatedAt = now;

  // Build PermissionResult for canUseTool callback
  let result: any;
  switch (response.action) {
    case 'answer': {
      approval.status = 'answered';
      // Build answers map: { "question text": "selected label/answer text" }
      const questions = (approval.toolInput.questions as any[]) ?? [];
      const answers: Record<string, string> = {};
      if (questions.length > 0) {
        // Map each question to the user's answer
        answers[questions[0].question] = response.text!;
      }
      result = {
        behavior: 'allow',
        updatedInput: {
          questions: approval.toolInput.questions,  // echo back original questions
          answers,                                   // { "question text": "answer" }
        },
      };
      break;
    }
    case 'approve':
      approval.status = 'approved';
      // updatedInput is required by SDK Zod validation — echo back original input
      result = { behavior: 'allow', updatedInput: { ...approval.toolInput } };
      break;
    case 'reject':
      approval.status = 'rejected';
      result = {
        behavior: 'deny',
        message: response.text || 'User rejected this action.',
      };
      break;
  }

  broadcast('approval:updated', approval);
  jobAddLog(approval.jobId, {
    type: 'user',
    content: response.action === 'answer'
      ? `Answered: "${response.text}"`
      : `${response.action === 'approve' ? 'Approved' : 'Rejected'}${response.text ? `: "${response.text}"` : ''}`,
    meta: { approvalId: id },
  });

  console.log(`[resolveApproval] ${id} action=${response.action} result=`, JSON.stringify(result));
  pendingResolvers.delete(id);
  resolver(result);

  // Prune resolved approvals beyond 100
  const resolved = approvals.filter(a => a.status !== 'pending');
  if (resolved.length > 100) {
    const cutoff = resolved.length - 100;
    const toRemove = new Set(resolved.slice(0, cutoff).map(a => a.id));
    for (let i = approvals.length - 1; i >= 0; i--) {
      if (toRemove.has(approvals[i].id)) approvals.splice(i, 1);
    }
  }
}

function expirePendingApprovals(jobId: string) {
  for (const a of approvals) {
    if (a.jobId === jobId && a.status === 'pending') {
      a.status = 'expired';
      a.updatedAt = new Date().toISOString();
      // Clear auto-approve timer if it exists
      const timer = approvalTimers.get(a.id);
      if (timer) {
        clearTimeout(timer);
        approvalTimers.delete(a.id);
      }
      const resolver = pendingResolvers.get(a.id);
      if (resolver) {
        pendingResolvers.delete(a.id);
        resolver({ behavior: 'deny', message: 'Job ended — approval expired' });
      }
      broadcast('approval:updated', a);
    }
  }
}

// ── Tool result content extraction ─────────────────────────────
// Extract human-readable content from SDK tool results.
// The SDK returns structured objects (e.g., { stdout, stderr } for Bash,
// { file: { content } } for Read). We extract the meaningful text BEFORE
// truncating, to avoid breaking JSON mid-string.
const MAX_TOOL_RESULT_LENGTH = 50000;  // generous limit; client handles display truncation

function extractToolResultContent(result: unknown): string {
  if (typeof result === 'string') return result.slice(0, MAX_TOOL_RESULT_LENGTH);
  if (result === null || result === undefined) return '(no output)';
  if (typeof result !== 'object') return String(result);

  const r = result as Record<string, any>;

  // Bash: { stdout, stderr, interrupted, ... }
  if ('stdout' in r || 'stderr' in r) {
    const out = ((r.stdout || '') + (r.stderr ? '\nSTDERR:\n' + r.stderr : '')).trim();
    return (out || '(no output)').slice(0, MAX_TOOL_RESULT_LENGTH);
  }

  // Read: { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
  if (r.file?.content !== undefined) {
    // Preserve the full structured JSON so the client can extract filePath, lineInfo etc.
    return JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH);
  }

  // Glob: { filenames: [...], truncated: bool }
  if (Array.isArray(r.filenames)) {
    // Preserve structure for client parsing
    return JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH);
  }

  // Grep: { mode, filenames, content, numLines, ... }
  if ('content' in r && typeof r.content === 'string') {
    return JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH);
  }

  // Write/Edit: { type: "create"|"update", filePath, ... }
  if (r.filePath && (r.type === 'create' || r.type === 'update')) {
    return JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH);
  }

  // WebSearch, WebFetch, Agent, and other complex results: preserve structure
  // Use a generous limit so the client can parse and render properly
  return JSON.stringify(result).slice(0, MAX_TOOL_RESULT_LENGTH);
}

// ── Unified Agent SDK job runner (channel-based) ────────────────
// All jobs use a pushable async generator. For mode='job', the channel
// is closed on result:success so the process exits. For mode='session',
// the process stays alive in 'idle' and accepts follow-up messages.
// Cron detection can auto-promote a job → session mid-execution.
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
  const channel = createMessageChannel();
  const session: { abort: AbortController; channel?: any; queryHandle?: any; cachedCommands?: any[] } = { abort: abortController, channel };
  activeQueries.set(job.id, session);

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
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'],
      disallowedTools: [],
      // No permissionMode: 'bypassPermissions' — canUseTool handles all permissions
      // (bypassPermissions skips canUseTool entirely, preventing approval interception)
      includePartialMessages: false,
      thinking: { type: 'disabled' },
      canUseTool: createCanUseTool(job.id, job.projectId),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'You are running on a headless server with a web UI. You CAN use AskUserQuestion, EnterPlanMode, and ExitPlanMode — a human operator will review and respond via the web UI. Use them when you need clarification or want to propose a plan. For routine decisions, proceed autonomously.',
      },
    };

    // Resume session if available
    if (job.sessionId) {
      (opts as any).resume = job.sessionId;
    }

    const isSession = job.mode === 'session';
    addLog({ type: 'system', content: `Starting ${isSession ? 'session' : 'job'} in ${cwd}` });
    addLog({ type: 'user', content: job.prompt });

    // Push the first user message into the generator
    channel.push({
      type: 'user' as const,
      message: { role: 'user' as const, content: job.prompt },
    });

    // Process messages — loop stays alive until generator is closed or aborted
    const queryHandle = query({ prompt: channel.generator, options: opts });
    session.queryHandle = queryHandle;
    for await (const message of queryHandle) {
      const msg = message as any;

      // Capture session ID from init + cache slash commands
      if (msg.type === 'system' && msg.subtype === 'init') {
        job.sessionId = msg.session_id;
        addLog({ type: 'system', content: `Session: ${msg.session_id} | Model: ${msg.model}` });

        // Proactively fetch full command list from SDK and cache it
        if (session.queryHandle?.supportedCommands) {
          session.queryHandle.supportedCommands()
            .then((cmds: any[]) => { session.cachedCommands = cmds; })
            .catch(() => {});
        }
        // Also use init message's slash_commands as immediate fallback
        if (msg.slash_commands && Array.isArray(msg.slash_commands) && !session.cachedCommands) {
          session.cachedCommands = msg.slash_commands.map((name: string) => ({
            name,
            description: '',
            argumentHint: '',
          }));
        }
      }

      // Session state changes (forward-compat with future SDK versions)
      if (msg.type === 'system' && msg.subtype === 'session_state_changed') {
        if (msg.state === 'idle' && job.status !== 'idle') {
          job.status = 'idle';
          job.updatedAt = new Date().toISOString();
          broadcast('job:updated', job);
          saveState();
        } else if (msg.state === 'running' && job.status !== 'running') {
          job.status = 'running';
          job.updatedAt = new Date().toISOString();
          broadcast('job:updated', job);
        }
      }

      // Local slash command output (e.g. /cost, /compact, /clear)
      if (msg.type === 'system' && msg.subtype === 'local_command_output') {
        addLog({ type: 'system', content: msg.content });
      }

      // Assistant messages + cron detection
      if (msg.type === 'assistant' && msg.message?.content) {
        // Detect parent_tool_use_id for subagent messages
        const parentToolUseId = msg.parent_tool_use_id ?? undefined;
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            addLog({ type: 'text', content: block.text, meta: parentToolUseId ? { parent_tool_use_id: parentToolUseId } : undefined });
          } else if (block.type === 'thinking') {
            const thinkingText = block.thinking || block.text || '';
            if (thinkingText) {
              addLog({ type: 'thinking', content: thinkingText, meta: parentToolUseId ? { parent_tool_use_id: parentToolUseId } : undefined });
            }
          } else if (block.type === 'tool_use') {
            addLog({
              type: 'tool',
              content: `🔧 ${block.name}`,
              meta: {
                input: block.input,
                tool_use_id: block.id,
                parent_tool_use_id: parentToolUseId,
              },
            });

            // Auto-promote job → session when cron/scheduled task detected
            if (job.mode !== 'session' && isSchedulingToolUse(block.name, block.input)) {
              job.mode = 'session';
              job.updatedAt = new Date().toISOString();
              addLog({ type: 'system', content: '🔄 Job promoted to session: scheduled task detected' });
              broadcast('job:updated', job);
              saveState();
            }
          }
        }
      }

      // Tool results — user messages carrying tool output back to Claude
      // The SDK provides results in two places:
      //   1. msg.tool_use_result (convenience, structured object — may be undefined)
      //   2. msg.content[] / msg.message.content[] (ToolResultBlock objects — always present)
      // We iterate over the content blocks to handle ALL results, including
      // multi-tool parallel calls and cases where tool_use_result is undefined.
      if (msg.type === 'user') {
        const parentToolUseId = msg.parent_tool_use_id ?? undefined;

        // Primary path: iterate over SDK content blocks (like claude_web does)
        const contentBlocks = msg.content ?? (msg.message as any)?.content ?? [];
        let handledAny = false;
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            // SDK ToolResultBlock: { type: 'tool_result', tool_use_id, content, is_error }
            const blockType = block.type ?? (block.constructor?.name === 'ToolResultBlock' ? 'tool_result' : '');
            if (blockType === 'tool_result') {
              const toolUseId = block.tool_use_id ?? undefined;
              const isError = block.is_error ?? false;
              const rawContent = block.content;
              const resultStr = typeof rawContent === 'string'
                ? rawContent.slice(0, 50000)
                : extractToolResultContent(rawContent);
              addLog({
                type: 'tool_result',
                content: resultStr || '(no output)',
                meta: {
                  tool_use_id: toolUseId,
                  parent_tool_use_id: parentToolUseId,
                  is_error: isError || undefined,
                },
              });
              handledAny = true;
            }
          }
        }

        // Fallback: if no content blocks found, try the legacy tool_use_result field
        if (!handledAny && msg.tool_use_result !== undefined) {
          const resultStr = extractToolResultContent(msg.tool_use_result);
          const toolUseId = (msg.message as any)?.content?.[0]?.tool_use_id ?? undefined;
          const isError = (msg.message as any)?.content?.[0]?.is_error ?? false;
          addLog({
            type: 'tool_result',
            content: resultStr,
            meta: {
              tool_use_id: toolUseId,
              parent_tool_use_id: parentToolUseId,
              is_error: isError || undefined,
            },
          });
        }
      }

      // Subagent lifecycle events (Agent tool spawns sub-tasks)
      if (msg.type === 'system' && msg.subtype === 'task_started') {
        addLog({
          type: 'system',
          content: `🤖 Subagent started`,
          meta: {
            subagent_task_id: msg.task_id,
            subagent_status: 'started',
            parent_tool_use_id: msg.tool_use_id,
          },
        });
      }
      if (msg.type === 'system' && msg.subtype === 'task_progress') {
        addLog({
          type: 'system',
          content: `🤖 Subagent progress`,
          meta: {
            subagent_task_id: msg.task_id,
            subagent_status: 'progress',
            parent_tool_use_id: msg.tool_use_id,
            subagent_usage: msg.usage,
          },
        });
      }
      if (msg.type === 'system' && msg.subtype === 'task_notification') {
        addLog({
          type: 'system',
          content: `🤖 Subagent ${msg.status === 'completed' ? 'completed' : 'failed'}`,
          meta: {
            subagent_task_id: msg.task_id,
            subagent_status: msg.status === 'completed' ? 'completed' : 'failed',
            parent_tool_use_id: msg.tool_use_id,
            subagent_usage: msg.usage,
          },
        });
      }

      // Turn result — mode-dependent behavior
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          job.result = msg.result;
          job.costUsd = msg.total_cost_usd;
          job.tokenUsage = {
            input: msg.usage?.input_tokens ?? 0,
            output: msg.usage?.output_tokens ?? 0,
          };

          if (job.mode === 'session') {
            // Session: stay alive, wait for next message
            job.status = 'idle';
            addLog({ type: 'result', content: msg.result ?? 'Turn complete' });
            saveState();
          } else {
            // Regular job: complete and close channel
            job.status = 'completed';
            addLog({ type: 'result', content: msg.result ?? 'Done' });
            channel.close();
          }
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
    expirePendingApprovals(job.id);
    activeQueries.delete(job.id);
    channel.close();
    // If the session/job ended normally from idle/running, mark completed
    if (job.status === 'idle' || job.status === 'running') {
      job.status = 'completed';
      addLog({ type: 'system', content: job.mode === 'session' ? 'Session ended' : 'Job ended' });
    }
    job.updatedAt = new Date().toISOString();
    broadcast('job:updated', job);
    saveState();
  }
}

// ── Pushable async generator for streaming input ────────────────
// The SDK expects an AsyncGenerator (yield-based), not a ReadableStream.
// This creates a generator that can be externally pushed to via push() and closed via close().
function createMessageChannel() {
  const queue: any[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const push = (msg: any) => {
    if (done) return;
    queue.push(msg);
    if (resolve) { resolve(); resolve = null; }
  };

  const close = () => {
    done = true;
    if (resolve) { resolve(); resolve = null; }
  };

  async function* generator(): AsyncGenerator<any, void> {
    while (true) {
      if (queue.length > 0) {
        const msg = queue.shift()!;
        console.log('[session-gen] yielding message:', JSON.stringify(msg).slice(0, 100));
        yield msg;
      } else if (done) {
        console.log('[session-gen] generator done, returning');
        return;
      } else {
        console.log('[session-gen] queue empty, waiting for push...');
        await new Promise<void>(r => { resolve = r; });
        console.log('[session-gen] push received, continuing loop');
      }
    }
  }

  return { push, close, generator: generator() };
}

// ── Cron / scheduled task detection ─────────────────────────────
// Built-in Claude Code tools that indicate scheduling
const CRON_TOOL_NAMES = new Set(['CronCreate', 'CronDelete']);

function detectCronInBashToolUse(input: unknown): boolean {
  const command = typeof input === 'string'
    ? input
    : (input as any)?.command ?? (input as any)?.content ?? '';
  if (typeof command !== 'string' || !command) return false;
  const CRON_PATTERNS = [
    /\bcrontab\b/,                                      // crontab -e, echo ... | crontab
    /\/etc\/cron\.\w+/,                                 // /etc/cron.d/, /etc/cron.daily/
    /\bsystemctl\s+(enable|start)\s+\S*\.timer\b/,     // systemd timer units
    /\bat\s+/,                                          // at command (one-time scheduling)
    /\bsystemd-run\b.*--on/,                            // systemd-run --on-calendar
  ];
  return CRON_PATTERNS.some(p => p.test(command));
}

function isSchedulingToolUse(toolName: string, input: unknown): boolean {
  // Direct cron tool detection (CronCreate, CronDelete)
  if (CRON_TOOL_NAMES.has(toolName)) return true;
  // Bash-based cron detection (crontab, systemd timer, etc.)
  if (toolName === 'Bash') return detectCronInBashToolUse(input);
  return false;
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

// Update job metadata (rename)
app.patch('/api/jobs/:id', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });

  const { name } = req.body;
  if (name !== undefined) {
    job.name = typeof name === 'string' && name.trim() ? name.trim() : undefined;
  }

  job.updatedAt = new Date().toISOString();
  saveState();
  broadcast('job:updated', job);
  res.json(job);
});

app.post('/api/jobs', (req, res) => {
  const { projectId, prompt, mode } = req.body;
  if (!projectId || !prompt) return res.status(400).json({ error: 'projectId and prompt required' });
  if (!projects.find(p => p.id === projectId)) return res.status(404).json({ error: 'project not found' });

  const job: Job = {
    id: uuid(),
    projectId,
    prompt,
    status: 'queued',
    mode: mode === 'session' ? 'session' : 'job',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
  };
  jobs.push(job);
  saveState();
  broadcast('job:created', job);

  // Start immediately — unified runner handles both modes
  runJob(job);

  res.status(201).json(job);
});

// Resume a completed/failed job OR send message to live session
app.post('/api/jobs/:id/continue', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });

  const { prompt } = req.body;
  const message = prompt ?? 'Continue from where you left off.';

  // Live session (or auto-promoted job): send message to live subprocess
  if (job.status === 'idle') {
    const session = activeQueries.get(job.id);
    if (session?.channel) {
      // Log the user message
      const log: LogEntry = { type: 'user', content: message, timestamp: new Date().toISOString() };
      job.logs.push(log);
      broadcast('job:log', { jobId: job.id, log });

      // Push to the live async generator
      session.channel.push({
        type: 'user' as const,
        message: { role: 'user' as const, content: message },
      });

      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      broadcast('job:updated', job);
      saveState();
      return res.status(200).json(job);
    }
    // Session is idle but no active query — subprocess was lost
    // Fall through to the restart-with-resume path below
    job.status = 'failed';
    job.error = 'Session process lost';
  }

  // Original behavior: spawn new subprocess with resume
  if (job.status === 'running') {
    return res.status(409).json({ error: 'job is active' });
  }

  // Reset existing job for continuation (no duplicate)
  job.prompt = message;
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
  expirePendingApprovals(job.id);
  if (job.status === 'running' || job.status === 'idle') {
    const q = activeQueries.get(job.id);
    if (q) {
      if (q.channel) { q.channel.close(); }
      q.abort.abort();
    }
  }
  job.status = 'archived';
  job.updatedAt = new Date().toISOString();
  saveState();
  broadcast('job:updated', job);
  res.json(job);
});

// Unarchive a job (restore to completed/failed)
app.post('/api/jobs/:id/unarchive', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.status !== 'archived') return res.status(400).json({ error: 'job is not archived' });
  job.status = job.error ? 'failed' : 'completed';
  job.updatedAt = new Date().toISOString();
  saveState();
  broadcast('job:updated', job);
  res.json(job);
});

// Stop a running/idle job
app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  expirePendingApprovals(job.id);
  const q = activeQueries.get(job.id);
  if (q) {
    if (q.channel) { q.channel.close(); }
    q.abort.abort();
    job.status = 'failed';
    job.error = 'Manually stopped';
    job.updatedAt = new Date().toISOString();
    saveState();
    broadcast('job:updated', job);
  }
  res.json(job);
});

// Gracefully close a long-running session
app.post('/api/jobs/:id/close-session', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (job.mode !== 'session') return res.status(400).json({ error: 'not a session job' });

  const session = activeQueries.get(job.id);
  if (session?.channel) {
    const log: LogEntry = { type: 'system', content: 'Session closing...', timestamp: new Date().toISOString() };
    job.logs.push(log);
    broadcast('job:log', { jobId: job.id, log });
    session.channel.close();
  }
  res.json(job);
});

// ── Slash commands (from SDK) ───────────────────────────────────
app.get('/api/jobs/:id/commands', async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });

  const session = activeQueries.get(job.id);
  if (!session) return res.json([]);

  // Try live SDK call first (has full descriptions)
  if (session.queryHandle?.supportedCommands) {
    try {
      const cmds = await session.queryHandle.supportedCommands();
      session.cachedCommands = cmds; // update cache
      return res.json(cmds);
    } catch {
      // fall through to cache
    }
  }

  // Fallback to cached commands (from init message or earlier successful fetch)
  if (session.cachedCommands?.length) {
    return res.json(session.cachedCommands);
  }

  res.json([]);
});

// ── Approvals API ───────────────────────────────────────────────
app.get('/api/approvals', (req, res) => {
  const { status, jobId } = req.query;
  let result = [...approvals];
  if (status) result = result.filter(a => a.status === status);
  if (jobId) result = result.filter(a => a.jobId === jobId);
  res.json(result.reverse());
});

app.post('/api/approvals/:id/respond', (req, res) => {
  try {
    const { id } = req.params;
    const body: ApprovalResponse = req.body;
    if (!body.action || !['answer', 'approve', 'reject'].includes(body.action)) {
      return res.status(400).json({ error: 'action must be answer|approve|reject' });
    }
    if (body.action === 'answer' && (!body.text || !body.text.trim())) {
      return res.status(400).json({ error: 'text is required for answer action' });
    }
    resolveApproval(id, body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
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

// ── File Search API ───────────────────────────────────────────
// Fuzzy search across file names and file content within a project
app.get('/api/projects/:id/files-search', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const q = (req.query.q as string ?? '').trim().toLowerCase();
  if (!q) return res.json({ files: [], contentMatches: [] });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const searchContent = req.query.content !== 'false'; // search file content by default

  // Collect all files recursively (respect same filters as file tree)
  const allFiles: { name: string; path: string; isDir: boolean }[] = [];
  const collectFiles = (dir: string, depth = 0) => {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const relPath = path.relative(project.path, path.join(dir, e.name));
        if (e.isDirectory()) {
          allFiles.push({ name: e.name, path: relPath, isDir: true });
          collectFiles(path.join(dir, e.name), depth + 1);
        } else {
          allFiles.push({ name: e.name, path: relPath, isDir: false });
        }
      }
    } catch { /* skip unreadable dirs */ }
  };
  collectFiles(project.path);

  // Fuzzy match helper: check if query chars appear in order in target
  const fuzzyMatch = (target: string, query: string): { match: boolean; score: number } => {
    const t = target.toLowerCase();
    let qi = 0;
    let score = 0;
    let lastIdx = -1;
    for (let i = 0; i < t.length && qi < query.length; i++) {
      if (t[i] === query[qi]) {
        // Consecutive bonus
        score += (lastIdx === i - 1) ? 2 : 1;
        // Start-of-word bonus
        if (i === 0 || t[i - 1] === '/' || t[i - 1] === '.' || t[i - 1] === '-' || t[i - 1] === '_') {
          score += 3;
        }
        lastIdx = i;
        qi++;
      }
    }
    return { match: qi === query.length, score };
  };

  // 1. Search file names (fuzzy)
  const fileMatches = allFiles
    .map(f => {
      const { match, score } = fuzzyMatch(f.path, q);
      return { ...f, score, match };
    })
    .filter(f => f.match)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ match: _, score: __, ...rest }) => rest);

  // 2. Search file content (substring match on each line)
  const contentMatches: { path: string; line: number; text: string; }[] = [];
  if (searchContent) {
    const textExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html',
      '.py', '.sh', '.yaml', '.yml', '.toml', '.cfg', '.ini', '.env',
      '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.xml', '.svg',
    ]);
    for (const f of allFiles) {
      if (f.isDir) continue;
      if (contentMatches.length >= limit) break;
      const ext = path.extname(f.name).toLowerCase();
      if (!textExtensions.has(ext) && ext !== '') continue;
      const fullPath = path.join(project.path, f.path);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 512 * 1024) continue; // skip files > 512KB
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            contentMatches.push({
              path: f.path,
              line: i + 1,
              text: lines[i].trim().slice(0, 200),
            });
            if (contentMatches.length >= limit) break;
          }
        }
      } catch { /* skip unreadable files */ }
    }
  }

  res.json({ files: fileMatches, contentMatches });
});

// ── Git Management API ─────────────────────────────────────────
const execFileAsync = promisify(execFile);

async function gitExec(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, maxBuffer, timeout: 30000 });
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await gitExec(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch { return false; }
}

// Git status — full repository state
app.get('/api/projects/:id/git/status', async (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  try {
    if (!(await isGitRepo(project.path))) {
      return res.json({ isGitRepo: false });
    }

    // Run git commands in parallel
    const [branchResult, statusResult, diffResult, diffCachedResult, aheadBehind] = await Promise.allSettled([
      gitExec(project.path, ['branch', '--show-current']),
      gitExec(project.path, ['status', '--porcelain']),
      gitExec(project.path, ['diff']),
      gitExec(project.path, ['diff', '--cached']),
      gitExec(project.path, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).catch(() => ({ stdout: '', stderr: '' })),
    ]);

    const branch = branchResult.status === 'fulfilled' ? branchResult.value.stdout.trim() : 'unknown';
    const statusLines = statusResult.status === 'fulfilled' ? statusResult.value.stdout.trim().split('\n').filter(Boolean) : [];
    const diff = diffResult.status === 'fulfilled' ? diffResult.value.stdout : '';
    const diffCached = diffCachedResult.status === 'fulfilled' ? diffCachedResult.value.stdout : '';

    let ahead = 0, behind = 0;
    if (aheadBehind.status === 'fulfilled') {
      const val = (aheadBehind.value as any);
      const stdout = typeof val === 'object' && val.stdout ? val.stdout : '';
      const parts = stdout.trim().split(/\s+/);
      if (parts.length === 2) {
        ahead = parseInt(parts[0]) || 0;
        behind = parseInt(parts[1]) || 0;
      }
    }

    // Parse porcelain status
    const staged: { path: string; status: string }[] = [];
    const unstaged: { path: string; status: string }[] = [];
    const untracked: string[] = [];

    for (const line of statusLines) {
      const x = line[0]; // index (staged) status
      const y = line[1]; // worktree (unstaged) status
      const filePath = line.slice(3).trim().replace(/^"(.*)"$/, '$1');

      if (x === '?' && y === '?') {
        untracked.push(filePath);
      } else {
        if (x && x !== ' ' && x !== '?') {
          staged.push({ path: filePath, status: x });
        }
        if (y && y !== ' ' && y !== '?') {
          unstaged.push({ path: filePath, status: y });
        }
      }
    }

    res.json({
      isGitRepo: true,
      branch,
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
      diff,
      diffCached,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'git status failed' });
  }
});

// Git diff — for a specific file or all
app.get('/api/projects/:id/git/diff', async (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  try {
    const file = req.query.file as string | undefined;
    const staged = req.query.staged === 'true';

    const args = ['diff'];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);

    const result = await gitExec(project.path, args, 2 * 1024 * 1024);

    // Also get stat summary
    const statArgs = ['diff', '--stat'];
    if (staged) statArgs.push('--cached');
    if (file) statArgs.push('--', file);
    const statResult = await gitExec(project.path, statArgs);

    // Parse numstat for per-file additions/deletions
    const numstatArgs = ['diff', '--numstat'];
    if (staged) numstatArgs.push('--cached');
    if (file) numstatArgs.push('--', file);
    const numstatResult = await gitExec(project.path, numstatArgs);

    const files = numstatResult.stdout.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      return {
        additions: parseInt(parts[0]) || 0,
        deletions: parseInt(parts[1]) || 0,
        path: parts[2] || '',
      };
    });

    res.json({ diff: result.stdout, stat: statResult.stdout.trim(), files });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'git diff failed' });
  }
});

// Git action — add, commit, push, pull, discard
app.post('/api/projects/:id/git/action', async (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  try {
    const { action, files: actionFiles, message } = req.body;

    let result: { stdout: string; stderr: string };

    switch (action) {
      case 'add':
        if (!actionFiles || !Array.isArray(actionFiles) || actionFiles.length === 0) {
          return res.status(400).json({ error: 'files required for add' });
        }
        result = await gitExec(project.path, ['add', ...actionFiles]);
        break;

      case 'add_all':
        result = await gitExec(project.path, ['add', '-A']);
        break;

      case 'commit':
        if (!message || typeof message !== 'string') {
          return res.status(400).json({ error: 'message required for commit' });
        }
        result = await gitExec(project.path, ['commit', '-m', message]);
        break;

      case 'push':
        result = await gitExec(project.path, ['push'], 5 * 1024 * 1024);
        break;

      case 'pull':
        result = await gitExec(project.path, ['pull'], 5 * 1024 * 1024);
        break;

      case 'discard':
        if (!actionFiles || !Array.isArray(actionFiles) || actionFiles.length === 0) {
          return res.status(400).json({ error: 'files required for discard' });
        }
        result = await gitExec(project.path, ['checkout', '--', ...actionFiles]);
        break;

      default:
        return res.status(400).json({ error: `unknown action: ${action}` });
    }

    res.json({ ok: true, output: (result.stdout + '\n' + result.stderr).trim() });
  } catch (err: any) {
    // Git commands return non-zero exit codes for things like "nothing to commit"
    // Include both stdout and stderr in the error response
    const output = ((err.stdout ?? '') + '\n' + (err.stderr ?? '')).trim();
    res.status(422).json({ ok: false, error: err.message ?? 'git action failed', output });
  }
});

// ── Search API ─────────────────────────────────────────────────
// Full-text search across job names, prompts, and log content
app.get('/api/search', (req, res) => {
  const q = (req.query.q as string ?? '').trim().toLowerCase();
  if (!q) return res.json([]);

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const searchLogs = req.query.logs !== 'false'; // search in log content by default

  interface SearchResult {
    jobId: string;
    projectId: string;
    jobName?: string;
    prompt: string;
    status: string;
    mode?: string;
    createdAt: string;
    updatedAt: string;
    costUsd?: number;
    matchField: 'name' | 'prompt' | 'log';
    matchPreview?: string;
    score: number;
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Fuzzy score: returns score > 0 if all query chars found in order, 0 if no match.
  // Bonuses: consecutive matches, word-start matches, exact substring match.
  function fuzzyScore(text: string, query: string): number {
    const t = text.toLowerCase();
    const qLen = query.length;
    if (!qLen) return 0;

    // Exact substring bonus
    const substringIdx = t.indexOf(query);
    if (substringIdx !== -1) {
      // High base score + bonus for early match
      return 1000 + (100 - Math.min(substringIdx, 99));
    }

    let ti = 0, qi = 0, score = 0, consecutive = 0;
    while (ti < t.length && qi < qLen) {
      if (t[ti] === query[qi]) {
        score += 10 + consecutive * 5;
        // Word-start bonus
        if (ti === 0 || /[\s\-_./]/.test(text[ti - 1])) score += 15;
        consecutive++;
        qi++;
      } else {
        consecutive = 0;
      }
      ti++;
    }
    return qi === qLen ? score : 0;
  }

  for (const job of jobs) {
    if (job.status === 'archived') continue;

    let bestScore = 0;
    let matchField: 'name' | 'prompt' | 'log' = 'prompt';
    let matchPreview: string | undefined;

    // Score on job name (highest priority)
    if (job.name) {
      const s = fuzzyScore(job.name, q);
      if (s > bestScore) { bestScore = s + 500; matchField = 'name'; } // name bonus
    }

    // Score on prompt
    const promptScore = fuzzyScore(job.prompt, q);
    if (promptScore > bestScore) { bestScore = promptScore + 200; matchField = 'prompt'; }

    // Score on log content (search through logs)
    if (searchLogs && bestScore < 500) { // only search logs if no strong match on name/prompt
      for (const log of job.logs) {
        if (log.type === 'tool_result') continue; // skip large tool results for performance
        const logLower = log.content.toLowerCase();
        const idx = logLower.indexOf(q);
        if (idx !== -1) {
          const logScore = 100; // flat score for log matches
          if (logScore > bestScore || (logScore >= bestScore && matchField !== 'name' && matchField !== 'prompt')) {
            bestScore = logScore;
            matchField = 'log';
            // Extract preview around the match
            const start = Math.max(0, idx - 40);
            const end = Math.min(log.content.length, idx + q.length + 60);
            matchPreview = (start > 0 ? '...' : '') + log.content.slice(start, end) + (end < log.content.length ? '...' : '');
          }
          break; // one log match is enough
        }
      }
    }

    if (bestScore > 0) {
      results.push({
        jobId: job.id,
        projectId: job.projectId,
        jobName: job.name,
        prompt: job.prompt,
        status: job.status,
        mode: job.mode,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        costUsd: job.costUsd,
        matchField,
        matchPreview,
        score: bestScore,
      });
      seen.add(job.id);
    }
  }

  // Sort by score descending, then by updatedAt descending
  results.sort((a, b) => b.score - a.score || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json(results.slice(0, limit));
});

// ── Memories API (full Claude Code memory hierarchy) ───────────

function readFileOrNull(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

function listMdFiles(dir: string): { name: string; path: string; content: string }[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const result: { name: string; path: string; content: string }[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.endsWith('.md')) {
        const content = readFileOrNull(full);
        if (content !== null) result.push({ name: e.name, path: full, content });
      } else if (e.isDirectory()) {
        result.push(...listMdFiles(full));
      }
    }
    return result;
  } catch { return []; }
}

// Derive auto-memory project dir: ~/.claude/projects/<sanitized-path>/memory/
function getAutoMemoryDir(projectPath: string): string {
  const userHome = process.env.HOME || process.env.USERPROFILE || '';
  // Claude Code uses the git root or project path, sanitized
  const sanitized = projectPath.replace(/\//g, '-').replace(/^-/, '');
  return path.join(userHome, '.claude', 'projects', sanitized, 'memory');
}

app.get('/api/projects/:id/memories', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const userHome = process.env.HOME || process.env.USERPROFILE || '';

  // All memory sources per Claude Code docs hierarchy:
  const sections: { level: string; label: string; path: string; content: string | null; editable: boolean; files?: { name: string; path: string; content: string }[] }[] = [];

  // 1. User-level CLAUDE.md
  const userMdPath = path.join(userHome, '.claude', 'CLAUDE.md');
  sections.push({ level: 'user', label: 'User Instructions', path: userMdPath, content: readFileOrNull(userMdPath), editable: true });

  // 2. User-level rules (~/.claude/rules/)
  const userRulesDir = path.join(userHome, '.claude', 'rules');
  const userRules = listMdFiles(userRulesDir);
  if (userRules.length > 0) {
    sections.push({ level: 'user-rules', label: 'User Rules', path: userRulesDir, content: null, editable: false, files: userRules });
  }

  // 3. Project CLAUDE.md (./CLAUDE.md)
  const projectMdPath = path.join(project.path, 'CLAUDE.md');
  sections.push({ level: 'project', label: 'Project Instructions', path: projectMdPath, content: readFileOrNull(projectMdPath), editable: true });

  // 4. Project .claude/CLAUDE.md (alternate location)
  const projectDotClaudeMdPath = path.join(project.path, '.claude', 'CLAUDE.md');
  const dotClaudeContent = readFileOrNull(projectDotClaudeMdPath);
  if (dotClaudeContent !== null) {
    sections.push({ level: 'project-dotclaude', label: 'Project .claude/', path: projectDotClaudeMdPath, content: dotClaudeContent, editable: true });
  }

  // 5. CLAUDE.local.md
  const localMdPath = path.join(project.path, 'CLAUDE.local.md');
  const localContent = readFileOrNull(localMdPath);
  if (localContent !== null) {
    sections.push({ level: 'local', label: 'Local Instructions', path: localMdPath, content: localContent, editable: true });
  }

  // 6. Project rules (.claude/rules/)
  const projectRulesDir = path.join(project.path, '.claude', 'rules');
  const projectRules = listMdFiles(projectRulesDir);
  if (projectRules.length > 0) {
    sections.push({ level: 'project-rules', label: 'Project Rules', path: projectRulesDir, content: null, editable: false, files: projectRules });
  }

  // 7. Auto memory
  const autoMemDir = getAutoMemoryDir(project.path);
  const autoMemFiles = listMdFiles(autoMemDir);
  if (autoMemFiles.length > 0) {
    sections.push({ level: 'auto-memory', label: 'Auto Memory', path: autoMemDir, content: null, editable: false, files: autoMemFiles });
  }

  res.json({ sections });
});

app.put('/api/projects/:id/memories', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const { filePath, content } = req.body;
  if (typeof filePath !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ error: 'filePath and content required' });
  }

  // Security: only allow writing to known safe locations
  const userHome = process.env.HOME || process.env.USERPROFILE || '';
  const allowed = [
    path.join(userHome, '.claude'),
    project.path,
  ];
  const resolved = path.resolve(filePath);
  if (!allowed.some(a => resolved.startsWith(a))) {
    return res.status(403).json({ error: 'forbidden path' });
  }

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    res.json({ ok: true, path: resolved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cron / Scheduled Tasks API ─────────────────────────────────
// Reconstruct cron state from job logs (CronCreate/CronDelete tool calls + results)
function extractCronFromLogs(job: Job): any[] {
  const created = new Map<string, any>();
  const logs = job.logs;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.type !== 'tool') continue;
    const toolName = log.content.replace(/^🔧\s*/, '');
    const input = log.meta?.input as Record<string, unknown> | undefined;
    if (!input) continue;

    // Find the matching tool_result (next tool_result log after this tool log)
    let resultContent: string | undefined;
    for (let j = i + 1; j < logs.length; j++) {
      if (logs[j].type === 'tool_result') {
        resultContent = logs[j].content;
        break;
      }
      if (logs[j].type === 'tool') break; // hit next tool, no result
    }

    if (toolName === 'CronCreate') {
      // Parse job ID from result (often JSON with an id field)
      let jobId: string | undefined;
      if (resultContent) {
        try {
          const parsed = JSON.parse(resultContent);
          jobId = parsed.id ?? parsed.jobId;
        } catch {
          // result might be plain text like "Created job abc123"
          const match = resultContent.match(/\b([a-f0-9-]{8,})\b/);
          if (match) jobId = match[1];
        }
      }
      const id = jobId ?? `unknown-${i}`;
      created.set(id, {
        id,
        cron: input.cron,
        prompt: input.prompt,
        recurring: input.recurring !== false,
        durable: input.durable === true,
        createdAt: log.timestamp,
        source: 'session',
      });
    } else if (toolName === 'CronDelete') {
      const id = input.id as string;
      if (id) created.delete(id);
    }
  }

  return Array.from(created.values());
}

app.get('/api/projects/:id/cron', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  // 1. File-based durable tasks
  const cronPath = path.join(project.path, '.claude', 'scheduled_tasks.json');
  let fileTasks: any[] = [];
  try {
    const data = JSON.parse(fs.readFileSync(cronPath, 'utf-8'));
    fileTasks = (Array.isArray(data) ? data : (data.tasks ?? [])).map((t: any) => ({ ...t, source: 'file' }));
  } catch {}

  // 2. Session-derived tasks from job logs (for the requested job, or all project jobs)
  const { jobId } = req.query;
  const targetJobs = jobId
    ? jobs.filter(j => j.id === jobId)
    : jobs.filter(j => j.projectId === project.id && (j.status === 'running' || j.status === 'idle'));
  const sessionTasks: any[] = [];
  for (const j of targetJobs) {
    const extracted = extractCronFromLogs(j);
    sessionTasks.push(...extracted.map(t => ({ ...t, jobId: j.id })));
  }

  // Deduplicate: file tasks take precedence by id
  const seen = new Set(fileTasks.map((t: any) => t.id).filter(Boolean));
  const merged = [
    ...fileTasks,
    ...sessionTasks.filter(t => !seen.has(t.id)),
  ];

  res.json({ path: cronPath, tasks: merged });
});

// ── HTTP + WebSocket server ─────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  // Send current state on connect (include pending approvals)
  ws.send(JSON.stringify({ event: 'init', data: {
    projects,
    jobs: jobs.map(j => ({ ...j, logs: [] })),
    approvals: approvals.filter(a => a.status === 'pending'),
  } }));
});

loadState();

server.listen(PORT, () => {
  console.log(`🚀 Claude Code Server running on http://localhost:${PORT}`);
  console.log(`📁 Projects root: ${PROJECTS_ROOT}`);
});
