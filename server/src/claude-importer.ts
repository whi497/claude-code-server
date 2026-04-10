/**
 * claude-importer.ts — Discover and import sessions from ~/.claude/projects/
 *
 * The local Claude Code CLI stores conversation logs as JSONL files in:
 *   ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
 *
 * Directory names encode the real filesystem path by replacing '/' with '-'.
 * Each .jsonl contains one JSON object per line with types:
 *   user, assistant, system, last-prompt, file-history-snapshot, attachment, queue-operation
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import type { Project, Job, LogEntry, LocalProject, LocalSession } from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_IMPORTED_LOGS = 50;
const META_SCAN_LINES = 20; // lines to read for quick metadata scan

// ── Path decoding ────────────────────────────────────────────────

/**
 * Decode a ~/.claude/projects/ directory name back to a real path.
 * Encoding: absolute path with every '/' replaced by '-'.
 * e.g. "-mnt-foo-bar" → "/mnt/foo/bar"
 *
 * WARNING: breaks on paths with literal hyphens. Use cwd from JSONL when available.
 */
function decodeDirName(dirName: string): string {
  // Leading '-' represents the root '/'
  if (dirName.startsWith('-')) {
    return '/' + dirName.slice(1).replace(/-/g, '/');
  }
  return dirName.replace(/-/g, '/');
}

/**
 * Extract the project name from a real path (last path component).
 */
function projectNameFromPath(realPath: string): string {
  return path.basename(realPath) || realPath;
}

// ── JSONL line parsing helpers ───────────────────────────────────

interface JnlUserMsg {
  type: 'user';
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: { role: string; content: string | Array<{ type: string; text?: string }> };
}

interface JnlAssistantMsg {
  type: 'assistant';
  timestamp?: string;
  message?: {
    role: string;
    model?: string;
    content?: Array<{ type: string; text?: string; thinking?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  slug?: string;
}

interface JnlLastPrompt {
  type: 'last-prompt';
  lastPrompt?: string;
  sessionId?: string;
}

type JnlLine = JnlUserMsg | JnlAssistantMsg | JnlLastPrompt | { type: string };

function safeParseLine(line: string): JnlLine | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractUserText(msg: JnlUserMsg): string {
  if (!msg.message?.content) return '';
  if (typeof msg.message.content === 'string') return msg.message.content;
  if (Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

function extractAssistantText(msg: JnlAssistantMsg): string {
  if (!msg.message?.content) return '';
  return msg.message.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

// ── Quick metadata scan (first N lines) ──────────────────────────

export async function scanSessionMeta(filePath: string): Promise<LocalSession | null> {
  const fileName = path.basename(filePath);
  const sessionId = fileName.replace(/\.jsonl$/, '');

  // Validate UUID-like filename
  if (!/^[0-9a-f-]{36}\.jsonl$/.test(fileName) && !/^[0-9a-f-]+\.jsonl$/.test(fileName)) {
    return null;
  }

  let firstPrompt: string | undefined;
  let slug: string | undefined;
  let startedAt: string | undefined;
  let lastActivity: string | undefined;
  let messageCount = 0;
  let realSessionId: string | undefined;

  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    let lineCount = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;
      const parsed = safeParseLine(line);
      if (!parsed) continue;

      if (parsed.type === 'user') {
        const userMsg = parsed as JnlUserMsg;
        messageCount++;
        if (!realSessionId && userMsg.sessionId) realSessionId = userMsg.sessionId;
        if (!startedAt && userMsg.timestamp) startedAt = userMsg.timestamp;
        if (userMsg.timestamp) lastActivity = userMsg.timestamp;
        if (!firstPrompt) {
          const text = extractUserText(userMsg);
          if (text) firstPrompt = text.slice(0, 120);
        }
      } else if (parsed.type === 'assistant') {
        const asstMsg = parsed as JnlAssistantMsg;
        messageCount++;
        if (!slug && asstMsg.slug) slug = asstMsg.slug;
        if (asstMsg.timestamp) lastActivity = asstMsg.timestamp;
      } else if (parsed.type === 'last-prompt') {
        const lp = parsed as JnlLastPrompt;
        if (!firstPrompt && lp.lastPrompt) firstPrompt = lp.lastPrompt;
      }

      lineCount++;
      if (lineCount >= META_SCAN_LINES && firstPrompt) {
        rl.close();
        break; // enough metadata
      }
    }

    if (messageCount === 0) return null; // empty session

    return {
      fileName,
      sessionId: realSessionId || sessionId,
      slug,
      firstPrompt,
      messageCount,
      startedAt,
      lastActivity,
    };
  } catch {
    return null; // corrupted file
  }
}

// ── Discover local projects ──────────────────────────────────────

export async function discoverLocalProjects(
  existingProjects: Project[],
  existingJobs: Job[],
): Promise<LocalProject[]> {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return [];

  const dirEntries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  const results: LocalProject[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip .state.json etc.

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, entry.name);
    const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) continue;

    // Scan first session to get real path from cwd
    let realPath: string | undefined;
    const sessions: LocalSession[] = [];

    for (const jf of jsonlFiles) {
      const meta = await scanSessionMeta(path.join(projectDir, jf));
      if (meta) {
        sessions.push(meta);
        // Try to get cwd from first user message for real path
        if (!realPath) {
          realPath = await extractCwdFromFile(path.join(projectDir, jf));
        }
      }
    }

    if (sessions.length === 0) continue;

    // Fallback: decode dir name
    if (!realPath) {
      realPath = decodeDirName(entry.name);
    }

    // Check if project already exists in app
    const existingProject = existingProjects.find(
      (p) => normalizePath(p.path) === normalizePath(realPath!),
    );

    // Mark already-imported sessions
    const projectJobs = existingProject
      ? existingJobs.filter((j) => j.projectId === existingProject.id)
      : [];
    for (const session of sessions) {
      session.alreadyImported = isSessionImported(session, projectJobs, realPath!);
    }

    // Sort sessions by lastActivity (newest first)
    sessions.sort((a, b) => {
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    const lastActivity = sessions[0]?.lastActivity;

    results.push({
      dirName: entry.name,
      realPath: realPath!,
      projectName: projectNameFromPath(realPath!),
      sessionCount: sessions.length,
      lastActivity,
      existingProjectId: existingProject?.id,
      sessions,
    });
  }

  // Sort by lastActivity (newest first)
  results.sort((a, b) => {
    if (!a.lastActivity && !b.lastActivity) return 0;
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
  });

  return results;
}

// ── Full session parse (for import) ──────────────────────────────

export async function parseClaudeSession(
  filePath: string,
): Promise<{ prompt: string; name?: string; sessionId?: string; createdAt?: string; updatedAt?: string; tokenUsage?: { input: number; output: number }; logs: LogEntry[] } | null> {
  const logs: LogEntry[] = [];
  let firstPrompt = '';
  let slug: string | undefined;
  let sessionId: string | undefined;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  let lastPromptText: string | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      const parsed = safeParseLine(line);
      if (!parsed) continue;

      switch (parsed.type) {
        case 'user': {
          const userMsg = parsed as JnlUserMsg;
          if (!sessionId && userMsg.sessionId) sessionId = userMsg.sessionId;
          if (!createdAt && userMsg.timestamp) createdAt = userMsg.timestamp;
          if (userMsg.timestamp) updatedAt = userMsg.timestamp;

          const text = extractUserText(userMsg);
          if (!firstPrompt && text) firstPrompt = text;

          if (text && logs.length < MAX_IMPORTED_LOGS) {
            logs.push({
              timestamp: userMsg.timestamp || new Date().toISOString(),
              type: 'user',
              content: text,
            });
          }
          break;
        }
        case 'assistant': {
          const asstMsg = parsed as JnlAssistantMsg;
          if (!slug && asstMsg.slug) slug = asstMsg.slug;
          if (asstMsg.timestamp) updatedAt = asstMsg.timestamp;

          // Accumulate token usage
          if (asstMsg.message?.usage) {
            totalInputTokens += asstMsg.message.usage.input_tokens ?? 0;
            totalOutputTokens += asstMsg.message.usage.output_tokens ?? 0;
          }

          const text = extractAssistantText(asstMsg);
          if (text && logs.length < MAX_IMPORTED_LOGS) {
            logs.push({
              timestamp: asstMsg.timestamp || new Date().toISOString(),
              type: 'text',
              content: text,
            });
          }

          // Extract tool_use blocks
          if (asstMsg.message?.content && logs.length < MAX_IMPORTED_LOGS) {
            for (const block of asstMsg.message.content) {
              if ((block as any).type === 'tool_use') {
                const tb = block as any;
                logs.push({
                  timestamp: asstMsg.timestamp || new Date().toISOString(),
                  type: 'tool',
                  content: tb.name || 'tool',
                  meta: { input: tb.input, tool_use_id: tb.id },
                });
              }
            }
          }
          break;
        }
        case 'last-prompt': {
          const lp = parsed as JnlLastPrompt;
          if (lp.lastPrompt) lastPromptText = lp.lastPrompt;
          break;
        }
        // Explicitly skip: system, file-history-snapshot, attachment, queue-operation
        default:
          break;
      }
    }

    if (!firstPrompt) return null;

    return {
      prompt: firstPrompt,
      name: slug || lastPromptText || firstPrompt.slice(0, 80),
      sessionId,
      createdAt,
      updatedAt,
      tokenUsage:
        totalInputTokens > 0 || totalOutputTokens > 0
          ? { input: totalInputTokens, output: totalOutputTokens }
          : undefined,
      logs,
    };
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

async function extractCwdFromFile(filePath: string): Promise<string | undefined> {
  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      const parsed = safeParseLine(line);
      if (parsed && parsed.type === 'user') {
        const userMsg = parsed as JnlUserMsg;
        rl.close();
        return userMsg.cwd || undefined;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\/+$/, '');
}

function isSessionImported(session: LocalSession, projectJobs: Job[], _projectPath: string): boolean {
  // Primary: match by sessionId
  if (projectJobs.some((j) => j.sessionId === session.sessionId)) return true;

  // Secondary: match by (prompt prefix, createdAt) for legacy jobs without sessionId
  if (session.firstPrompt && session.startedAt) {
    const promptPrefix = session.firstPrompt.slice(0, 200);
    return projectJobs.some(
      (j) =>
        !j.sessionId &&
        j.prompt.slice(0, 200) === promptPrefix &&
        j.createdAt === session.startedAt,
    );
  }

  return false;
}
