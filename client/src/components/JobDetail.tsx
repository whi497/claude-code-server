import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../hooks/api';
import { useSuggestions, type CommandDef, type SDKSlashCommand } from '../hooks/useSuggestions';
import { SuggestionDropdown } from './SuggestionDropdown';
import type { Job, LogEntry } from '../types';
import { Square, Archive, Play, FolderTree, ScrollText, MessageSquare, ChevronDown, ChevronRight, Wrench, Terminal, FileText, Search, Edit3, PenTool, Globe, Bot, FileCode, Copy, BookOpen, Clock, Save, X, Folder, FolderOpen, File, RefreshCw, GitBranch, Plus, Upload, Download, Check, Undo2, Star } from 'lucide-react';
import { renderInline, isTableRow, isTableSeparator, renderTable, renderMarkdown } from './Markdown';

interface Props {
  job: Job;
  logs: LogEntry[];
  projectId: string;
  onNewJob?: () => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Per-tool border colors (from claude_web's tool-configs.js) ──
function getToolBorderColor(name: string): string {
  switch (name) {
    case 'Bash':
      return 'var(--tool-border-green, #22c55e)';
    case 'Write':
      return 'var(--tool-border-green, #22c55e)';
    case 'Edit':
    case 'NotebookEdit':
      return 'var(--tool-border-amber, #f59e0b)';
    case 'Read':
    case 'Grep':
    case 'Glob':
    case 'CronCreate':
    case 'CronDelete':
    case 'CronList':
      return 'var(--tool-border-gray, #6b7280)';
    case 'LSP':
    case 'WebSearch':
    case 'WebFetch':
    case 'AskUserQuestion':
    case 'EnterPlanMode':
      return 'var(--tool-border-blue, #3b82f6)';
    case 'ExitPlanMode':
      return 'var(--tool-border-indigo, #6366f1)';
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
    case 'TodoWrite':
    case 'TodoRead':
      return 'var(--tool-border-violet, #8b5cf6)';
    case 'Agent':
    case 'Skill':
      return 'var(--tool-border-purple, #a855f7)';
    default:
      return 'var(--tool-border-gray, #6b7280)';
  }
}

// ── Chat message grouping (ordered parts) ────────────────────
type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; input: unknown; result?: string; id?: string; isError?: boolean;
      children?: ChatPart[] };    // subagent nested tool calls

interface ChatMessage {
  role: 'assistant' | 'user';
  parts: ChatPart[];
  timestamp: string;
  isResult?: boolean;
  isError?: boolean;
}

function groupLogsIntoChatMessages(logs: LogEntry[], isRunning: boolean): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let current: ChatMessage | null = null;

  // Build a map of tool_use_id → tool ChatPart for ID-based result matching
  const toolPartById = new Map<string, ChatPart & { kind: 'tool' }>();
  // Track orphaned parts whose parent hasn't been seen yet (for re-parenting at end)
  const orphans: { parentId: string; part: ChatPart; msgIdx: number; partIdx: number }[] = [];

  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };

  // Helper: find the parent Agent tool part to nest child parts into
  const findParentTool = (parentToolUseId: string): (ChatPart & { kind: 'tool' }) | undefined => {
    return toolPartById.get(parentToolUseId);
  };

  for (const log of logs) {
    if (log.type === 'system') continue;

    // Skip subagent lifecycle events (they're handled via the parent tool)
    if (log.meta?.subagent_status) continue;

    const parentId = log.meta?.parent_tool_use_id;

    if (log.type === 'user') {
      flush();
      current = { role: 'user', parts: [{ kind: 'text', text: log.content }], timestamp: log.timestamp };
      flush();
      continue;
    }

    if (log.type === 'thinking') {
      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', parts: [], timestamp: log.timestamp };
      }
      // Merge consecutive thinking parts
      const lastPart = current.parts[current.parts.length - 1];
      if (lastPart && lastPart.kind === 'thinking') {
        lastPart.text += '\n' + log.content;
      } else {
        current.parts.push({ kind: 'thinking', text: log.content });
      }
      continue;
    }

    if (log.type === 'text') {
      // If this is a subagent text, nest it
      if (parentId) {
        const parent = findParentTool(parentId);
        if (parent) {
          if (!parent.children) parent.children = [];
          const lastChild = parent.children[parent.children.length - 1];
          if (lastChild && lastChild.kind === 'text') {
            lastChild.text += '\n' + log.content;
          } else {
            parent.children.push({ kind: 'text', text: log.content });
          }
          continue;
        }
        // Parent not found yet — place at top level, record as orphan for re-parenting
      }
      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', parts: [], timestamp: log.timestamp };
      }
      const textPart: ChatPart = { kind: 'text', text: log.content };
      const lastPart = current.parts[current.parts.length - 1];
      if (!parentId && lastPart && lastPart.kind === 'text') {
        lastPart.text += '\n' + log.content;
      } else {
        current.parts.push(textPart);
        if (parentId) {
          orphans.push({ parentId, part: textPart, msgIdx: messages.length, partIdx: current.parts.length - 1 });
        }
      }
    } else if (log.type === 'tool') {
      const toolName = log.content.replace(/^🔧\s*/, '');
      const toolUseId = log.meta?.tool_use_id;

      // Subagent tool call → nest inside parent
      if (parentId) {
        const parent = findParentTool(parentId);
        if (parent) {
          if (!parent.children) parent.children = [];
          const childTool: ChatPart & { kind: 'tool' } = { kind: 'tool', name: toolName, input: log.meta?.input, id: toolUseId };
          parent.children.push(childTool);
          if (toolUseId) toolPartById.set(toolUseId, childTool);
          continue;
        }
        // Parent not found yet — place at top level, record as orphan for re-parenting
      }

      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', parts: [], timestamp: log.timestamp };
      }
      const toolPart: ChatPart & { kind: 'tool' } = { kind: 'tool', name: toolName, input: log.meta?.input, id: toolUseId };
      current.parts.push(toolPart);
      if (toolUseId) toolPartById.set(toolUseId, toolPart);
      if (parentId) {
        orphans.push({ parentId, part: toolPart, msgIdx: messages.length, partIdx: current.parts.length - 1 });
      }
    } else if (log.type === 'tool_result') {
      const resultToolUseId = log.meta?.tool_use_id;
      const isError = log.meta?.is_error;

      // Try ID-based matching first (most reliable)
      if (resultToolUseId) {
        const matchedTool = toolPartById.get(resultToolUseId);
        if (matchedTool) {
          matchedTool.result = log.content;
          if (isError) matchedTool.isError = true;
          continue;
        }
      }

      // Fallback: attach to the last tool part without a result (backward scan)
      if (current) {
        for (let j = current.parts.length - 1; j >= 0; j--) {
          const p = current.parts[j];
          if (p.kind === 'tool' && !p.result) {
            p.result = log.content;
            if (isError) p.isError = true;
            break;
          }
        }
      }
    } else if (log.type === 'result') {
      flush();
      current = { role: 'assistant', parts: [{ kind: 'text', text: log.content }], timestamp: log.timestamp, isResult: true };
    } else if (log.type === 'error') {
      flush();
      current = { role: 'assistant', parts: [{ kind: 'text', text: log.content }], timestamp: log.timestamp, isError: true };
    }
  }
  flush();

  // Re-parent orphaned parts whose parent wasn't seen at creation time
  // Process in reverse so index-based removal doesn't shift subsequent indices
  for (let o = orphans.length - 1; o >= 0; o--) {
    const { parentId: opId, part, msgIdx, partIdx } = orphans[o];
    const parent = toolPartById.get(opId);
    if (!parent) continue;  // parent still not found — leave at top level
    // Add to parent's children
    if (!parent.children) parent.children = [];
    parent.children.push(part);
    // Remove from the original top-level message.parts
    const msg = messages[msgIdx];
    if (msg && msg.parts[partIdx] === part) {
      msg.parts.splice(partIdx, 1);
    }
  }

  // Clean up empty messages that may result from orphan removal
  return messages.filter(m => m.parts.length > 0);
}

// ── Tool icons and smart summaries ────────────────────────────
function getToolIcon(name: string) {
  switch (name) {
    case 'Bash': return <Terminal size={12} />;
    case 'Read': return <FileText size={12} />;
    case 'Write': return <FileCode size={12} />;
    case 'Edit': return <Edit3 size={12} />;
    case 'Grep': return <Search size={12} />;
    case 'Glob': return <Search size={12} />;
    case 'Agent': return <Bot size={12} />;
    case 'WebFetch': case 'WebSearch': return <Globe size={12} />;
    case 'TodoWrite': return <PenTool size={12} />;
    default: return <Wrench size={12} />;
  }
}

function getToolSummary(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const inp = input as Record<string, unknown>;

  switch (name) {
    case 'Bash': {
      if (inp.description && typeof inp.description === 'string') return inp.description;
      if (inp.command && typeof inp.command === 'string') {
        const cmd = inp.command as string;
        return cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd;
      }
      return null;
    }
    case 'Read': {
      if (inp.file_path && typeof inp.file_path === 'string') {
        const p = inp.file_path as string;
        const parts = p.split('/');
        return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
      }
      return null;
    }
    case 'Write': {
      if (inp.file_path && typeof inp.file_path === 'string') {
        const p = inp.file_path as string;
        const parts = p.split('/');
        return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
      }
      return null;
    }
    case 'Edit': {
      if (inp.file_path && typeof inp.file_path === 'string') {
        const p = inp.file_path as string;
        const parts = p.split('/');
        return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
      }
      return null;
    }
    case 'Grep': {
      const parts: string[] = [];
      if (inp.pattern) parts.push(`/${inp.pattern}/`);
      if (inp.glob) parts.push(`in ${inp.glob}`);
      return parts.length > 0 ? parts.join(' ') : null;
    }
    case 'Glob': {
      if (inp.pattern && typeof inp.pattern === 'string') return inp.pattern as string;
      return null;
    }
    case 'Agent': {
      if (inp.description && typeof inp.description === 'string') {
        const desc = inp.description as string;
        const subtype = inp.subagent_type as string | undefined;
        if (subtype === 'Explore') return `Explore Agent — ${desc}`;
        if (subtype === 'Plan') return `Plan Agent — ${desc}`;
        if (subtype) return `${subtype} Agent — ${desc}`;
        return `Agent — ${desc}`;
      }
      if (inp.subagent_type && typeof inp.subagent_type === 'string') return `${inp.subagent_type} Agent`;
      return null;
    }
    case 'WebSearch': {
      if (inp.query && typeof inp.query === 'string') return `"${inp.query}"`;
      return null;
    }
    case 'WebFetch': {
      if (inp.url && typeof inp.url === 'string') {
        try {
          const u = new URL(inp.url as string);
          return u.hostname + u.pathname.slice(0, 40);
        } catch { return (inp.url as string).slice(0, 60); }
      }
      return null;
    }
    case 'TodoWrite': {
      if (inp.todos && Array.isArray(inp.todos)) return `${(inp.todos as unknown[]).length} items`;
      return null;
    }
    default:
      return null;
  }
}

// ── Per-tool body renderers ───────────────────────────────────

function shortPath(p: string, segments = 3): string {
  const parts = p.split('/');
  return parts.length > segments ? '…/' + parts.slice(-segments).join('/') : p;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryParseJSON(raw: string): any {
  if (raw.startsWith('"') || raw.startsWith('{') || raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch { /* use raw */ }
  }
  return null;
}

function parseToolResult(raw: string): string {
  const parsed = tryParseJSON(raw);
  if (parsed === null) return raw;
  if (typeof parsed === 'string') return parsed;
  // Bash: { stdout, stderr }
  if (typeof parsed === 'object' && 'stdout' in parsed) {
    const out = (parsed.stdout || '') + (parsed.stderr ? '\n' + parsed.stderr : '');
    return out || '(no output)';
  }
  // Read: { type: "text", file: { content } }
  if (typeof parsed === 'object' && parsed.file?.content !== undefined) {
    return parsed.file.content;
  }
  // Glob: { filenames: [...] }
  if (typeof parsed === 'object' && Array.isArray(parsed.filenames)) {
    return parsed.filenames.join('\n') || '(no matches)';
  }
  // Agent: { status, prompt, ... }
  if (typeof parsed === 'object' && parsed.status && parsed.prompt) {
    return parsed.result ?? parsed.status;
  }
  // Generic object — pretty print
  if (typeof parsed === 'object') return JSON.stringify(parsed, null, 2);
  return raw;
}

function parseReadResult(raw: string): { content: string; filePath?: string; startLine?: number; totalLines?: number } | null {
  const parsed = tryParseJSON(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  // Read: { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
  if (parsed.file?.content !== undefined) {
    return {
      content: parsed.file.content,
      filePath: parsed.file.filePath,
      startLine: parsed.file.startLine,
      totalLines: parsed.file.totalLines,
    };
  }
  return null;
}

function ToolBodyTodo({ input }: { input: Record<string, unknown> }) {
  const todos = input.todos as { content: string; status: string; activeForm?: string }[] | undefined;
  if (!todos || !Array.isArray(todos)) return null;
  return (
    <div className="tool-todo-list">
      {todos.map((t, i) => (
        <div key={i} className={`tool-todo-item tool-todo-${t.status}`}>
          <span className={`tool-todo-icon tool-todo-icon-${t.status}`}>
            {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '›' : '○'}
          </span>
          <span className="tool-todo-text">{t.content}</span>
        </div>
      ))}
    </div>
  );
}

function ToolBodyAgent({ input, result }: { input: Record<string, unknown>; result?: string }) {
  const prompt = input.prompt as string | undefined;
  const desc = input.description as string | undefined;
  return (
    <div className="tool-agent-body">
      {desc && <div className="tool-agent-desc">{desc}</div>}
      {prompt && (
        <div className="tool-agent-prompt">
          <div className="chat-tool-label">Prompt</div>
          <div className="tool-agent-prompt-content">{renderMarkdown(prompt)}</div>
        </div>
      )}
      {result !== undefined && (
        <div className="tool-agent-result">
          <div className="chat-tool-label">Result</div>
          <div className="tool-agent-result-content">{renderMarkdown(parseToolResult(result))}</div>
        </div>
      )}
    </div>
  );
}

function ToolBodyBash({ input, result }: { input: Record<string, unknown>; result?: string }) {
  const cmd = input.command as string | undefined;
  const desc = input.description as string | undefined;
  return (
    <div className="tool-bash-body">
      {desc && <div className="tool-bash-desc">{desc}</div>}
      {cmd && <pre className="tool-bash-cmd"><code>{cmd}</code></pre>}
      {result !== undefined && <pre className="tool-bash-output">{parseToolResult(result)}</pre>}
    </div>
  );
}

function computeUnifiedDiff(oldStr: string, newStr: string): { type: 'same' | 'del' | 'add'; text: string }[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const result: { type: 'same' | 'del' | 'add'; text: string }[] = [];

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Backtrack
  const ops: { type: 'same' | 'del' | 'add'; text: string }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'same', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', text: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: 'del', text: oldLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function ToolBodyEdit({ input }: { input: Record<string, unknown> }) {
  const filePath = input.file_path as string | undefined;
  const oldStr = input.old_string as string | undefined;
  const newStr = input.new_string as string | undefined;
  const replaceAll = input.replace_all as boolean | undefined;

  const diffLines = (oldStr !== undefined && newStr !== undefined)
    ? computeUnifiedDiff(oldStr, newStr)
    : null;

  return (
    <div className="tool-edit-body">
      {filePath && <div className="tool-file-path">{shortPath(filePath)}</div>}
      {replaceAll && <span className="tool-edit-badge">replace all</span>}
      {diffLines ? (
        <div className="tool-diff-unified">
          {diffLines.map((line, i) => (
            <div key={i} className={`tool-diff-line tool-diff-line-${line.type}`}>
              <span className="tool-diff-prefix">
                {line.type === 'del' ? '−' : line.type === 'add' ? '+' : ' '}
              </span>
              <span className="tool-diff-text">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="tool-diff">
          {oldStr !== undefined && <pre className="tool-diff-old">{oldStr || '(empty)'}</pre>}
          {newStr !== undefined && <pre className="tool-diff-new">{newStr || '(empty)'}</pre>}
        </div>
      )}
    </div>
  );
}

function ToolBodyReadWrite({ input, result, isWrite }: { input: Record<string, unknown>; result?: string; isWrite?: boolean }) {
  const filePath = input.file_path as string | undefined;
  const content = isWrite ? (input.content as string | undefined) : undefined;

  // For Read: extract structured content from SDK result
  const readData = !isWrite && result ? parseReadResult(result) : null;
  const displayContent = readData?.content ?? (result ? parseToolResult(result) : undefined);
  // If result parsing gave us a file path, prefer that (it's the full path)
  const displayPath = readData?.filePath ? shortPath(readData.filePath) : filePath ? shortPath(filePath) : undefined;
  const lineInfo = readData && readData.totalLines
    ? `${readData.totalLines} lines` + (readData.startLine && readData.startLine > 1 ? ` (from line ${readData.startLine})` : '')
    : null;

  // For error strings (not JSON)
  const isError = !isWrite && result !== undefined && !readData && (result.startsWith('Error:') || result.startsWith('error:'));

  return (
    <div className="tool-file-body">
      {displayPath && <div className="tool-file-path">{displayPath}</div>}
      {lineInfo && <span className="tool-file-meta">{lineInfo}</span>}
      {isWrite && content !== undefined && (
        <pre className="tool-file-content">{content.length > 800 ? content.slice(0, 800) + '\n…' : content}</pre>
      )}
      {!isWrite && isError && result !== undefined && (
        <div className="tool-file-error">{result}</div>
      )}
      {!isWrite && !isError && displayContent !== undefined && (
        <pre className="tool-file-content">{displayContent}</pre>
      )}
    </div>
  );
}

function ToolBodySearch({ input, result }: { input: Record<string, unknown>; result?: string }) {
  const pattern = input.pattern as string | undefined;
  const glob = input.glob as string | undefined;
  // Result is often a list of file paths or match lines
  const parsed = result ? parseToolResult(result) : result;
  const lines = parsed?.split('\n').filter(l => l.trim()) ?? [];
  return (
    <div className="tool-search-body">
      <div className="tool-search-query">
        {pattern && <code className="chat-inline-code">/{pattern}/</code>}
        {glob && <span className="tool-search-glob"> in {glob}</span>}
      </div>
      {lines.length > 0 && (
        <div className="tool-search-results">
          {lines.slice(0, 30).map((line, i) => (
            <div key={i} className="tool-search-line">{line}</div>
          ))}
          {lines.length > 30 && <div className="tool-search-more">…and {lines.length - 30} more</div>}
        </div>
      )}
    </div>
  );
}

function ToolBodyDefault({ result }: { result?: string }) {
  if (result === undefined) return null;
  const parsed = parseToolResult(result);
  const truncated = parsed.length > 800 ? parsed.slice(0, 800) + '…' : parsed;
  return <pre className="chat-tool-code chat-tool-output">{truncated}</pre>;
}

// ── Thinking block (collapsible) ──────────────────────────────
function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;

  return (
    <div className="chat-thinking-block" onClick={() => setExpanded(!expanded)}>
      <div className="chat-thinking-header">
        <span className="chat-tool-chevron">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="chat-thinking-label">Thinking</span>
        {!expanded && <span className="chat-thinking-preview">{preview}</span>}
      </div>
      {expanded && (
        <div className="chat-thinking-content">{text}</div>
      )}
    </div>
  );
}

// ── ToolCall collapsible block ─────────────────────────────────
function ToolCallBlock({ tool, isJobRunning, isLastInGroup, depth = 0 }: {
  tool: { name: string; input: unknown; result?: string; isError?: boolean; children?: ChatPart[] };
  isJobRunning: boolean;
  isLastInGroup: boolean;
  depth?: number;
}) {
  const isActive = isJobRunning && isLastInGroup && !tool.result;
  const isAgent = tool.name === 'Agent';
  const isNested = depth > 0;
  // Default open: TodoWrite/Edit/Write always open; Agent open while running;
  // Nested (subagent) blocks default collapsed
  const defaultOpen = isNested ? false : (tool.name === 'TodoWrite' || tool.name === 'Edit' || tool.name === 'Write' || isAgent);
  const [expanded, setExpanded] = useState(isActive || defaultOpen);
  const [showRaw, setShowRaw] = useState(false);
  const borderColor = getToolBorderColor(tool.name);
  const hasChildren = tool.children && tool.children.length > 0;

  useEffect(() => {
    if (isActive) setExpanded(true);
    // Agent: auto-collapse when complete (result arrives)
    else if (isAgent && tool.result !== undefined) setExpanded(false);
    // Non-Agent: auto-collapse when result arrives (except always-open tools)
    else if (tool.result !== undefined && !defaultOpen) setExpanded(false);
  }, [isActive, tool.result, defaultOpen, isAgent]);

  const summary = getToolSummary(tool.name, tool.input);
  const icon = getToolIcon(tool.name);
  const inp = (tool.input && typeof tool.input === 'object' ? tool.input : {}) as Record<string, unknown>;

  const renderBody = () => {
    if (showRaw) {
      const inputStr = typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2);
      return (
        <>
          <div className="chat-tool-section">
            <div className="chat-tool-label">Input</div>
            <pre className="chat-tool-code">{inputStr}</pre>
          </div>
          {tool.result !== undefined && (
            <div className="chat-tool-section">
              <div className="chat-tool-label">Output</div>
              <pre className="chat-tool-code chat-tool-output">{tool.result}</pre>
            </div>
          )}
        </>
      );
    }

    const bodyContent = (() => {
      switch (tool.name) {
        case 'TodoWrite':
          return <ToolBodyTodo input={inp} />;
        case 'Agent':
          return <ToolBodyAgent input={inp} result={tool.result} />;
        case 'Bash':
          return <ToolBodyBash input={inp} result={tool.result} />;
        case 'Edit':
          return <ToolBodyEdit input={inp} />;
        case 'Read':
          return <ToolBodyReadWrite input={inp} result={tool.result} />;
        case 'Write':
          return <ToolBodyReadWrite input={inp} result={tool.result} isWrite />;
        case 'Grep':
        case 'Glob':
          return <ToolBodySearch input={inp} result={tool.result} />;
        default:
          return <ToolBodyDefault result={tool.result} />;
      }
    })();

    return (
      <>
        {bodyContent}
        {/* Render subagent nested children */}
        {hasChildren && (
          <div className="chat-subagent-children">
            {tool.children!.map((child, ci) => {
              if (child.kind === 'text') {
                return (
                  <div key={ci} className="chat-subagent-text">
                    {renderMarkdown(child.text)}
                  </div>
                );
              }
              if (child.kind === 'thinking') {
                return <ThinkingBlock key={ci} text={child.text} />;
              }
              if (child.kind === 'tool') {
                return (
                  <div key={ci} className="chat-tool-calls">
                    <ToolCallBlock
                      tool={child}
                      isJobRunning={isJobRunning}
                      isLastInGroup={ci === tool.children!.length - 1 && isLastInGroup}
                      depth={depth + 1}
                    />
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className={`chat-tool-block ${isActive ? 'active' : ''} ${depth > 0 ? 'chat-tool-nested' : ''}`}
      style={{ borderLeftColor: borderColor }}
    >
      <div className="chat-tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="chat-tool-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {icon}
        <span className="chat-tool-name">{tool.name}</span>
        {summary && <span className="chat-tool-summary">{summary}</span>}
        {hasChildren && !expanded && <span className="chat-subagent-badge">{tool.children!.filter(c => c.kind === 'tool').length} steps</span>}
        {isActive && <span className="chat-tool-spinner" />}
        {!isActive && tool.result !== undefined && (
          <span className={`chat-tool-done ${tool.isError ? 'chat-tool-done-error' : ''}`}>
            {tool.isError ? 'error' : 'done'}
          </span>
        )}
      </div>
      {expanded && (
        <div className="chat-tool-body">
          {renderBody()}
          <button
            className="tool-raw-toggle"
            onClick={e => { e.stopPropagation(); setShowRaw(!showRaw); }}
          >
            {showRaw ? '← Rendered' : '{ } Raw'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Output log line (enhanced) ─────────────────────────────────
function OutputLogLine({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  // Tool logs: show icon + summary inline
  if (log.type === 'tool') {
    const toolName = log.content.replace(/^🔧\s*/, '');
    const summary = getToolSummary(toolName, log.meta?.input);
    const icon = getToolIcon(toolName);
    return (
      <div className={`log-line log-tool log-line-expandable`} onClick={() => setExpanded(!expanded)}>
        <span className="ts">{formatTime(log.timestamp)}</span>
        <span className="content log-tool-inline">
          {icon}
          <span className="log-tool-label">{toolName}</span>
          {summary && <span className="log-tool-summary">{summary}</span>}
        </span>
        {expanded && log.meta?.input != null && (
          <pre className="log-expanded-content" onClick={e => e.stopPropagation()}>
            {String(typeof log.meta.input === 'string' ? log.meta.input : JSON.stringify(log.meta.input, null, 2))}
          </pre>
        )}
      </div>
    );
  }

  // Tool results: expandable
  if (log.type === 'tool_result') {
    const preview = log.content.length > 120 ? log.content.slice(0, 120) + '…' : log.content;
    return (
      <div className={`log-line log-tool_result log-line-expandable`} onClick={() => setExpanded(!expanded)}>
        <span className="ts">{formatTime(log.timestamp)}</span>
        <span className="content">{expanded ? '' : preview}</span>
        {expanded && (
          <pre className="log-expanded-content" onClick={e => e.stopPropagation()}>
            {log.content}
          </pre>
        )}
      </div>
    );
  }

  // Text logs: render with markdown
  if (log.type === 'text') {
    return (
      <div className="log-line log-text">
        <span className="ts">{formatTime(log.timestamp)}</span>
        <span className="content log-text-md">
          {renderMarkdown(log.content)}
        </span>
      </div>
    );
  }

  // Result logs: render with markdown
  if (log.type === 'result') {
    return (
      <div className="log-line log-result">
        <span className="ts">{formatTime(log.timestamp)}</span>
        <span className="content log-text-md">
          {renderMarkdown(log.content)}
        </span>
      </div>
    );
  }

  // Default (system, error, user)
  return (
    <div className={`log-line log-${log.type}`}>
      <span className="ts">{formatTime(log.timestamp)}</span>
      <span className="content">{log.content}</span>
    </div>
  );
}

// ── Collapsible multi-file memory section ──────────────────────
function MemoryFilesSection({ section, badgeClass }: { section: any; badgeClass: string }) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const files = section.files as { name: string; path: string; content: string }[] ?? [];

  return (
    <div className="memory-section">
      <div className="memory-header">
        <div className="memory-level">
          <span className={`memory-badge ${badgeClass}`}>{section.label}</span>
          <span className="memory-path">{section.path}</span>
          <span className="memory-file-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="memory-files-list">
        {files.map(f => {
          const isOpen = expandedFile === f.path;
          const shortName = f.path.startsWith(section.path)
            ? f.path.slice(section.path.length).replace(/^\//, '')
            : f.name;
          return (
            <div key={f.path} className="memory-file-item">
              <div className="memory-file-header" onClick={() => setExpandedFile(isOpen ? null : f.path)}>
                <span className="chat-tool-chevron">
                  {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </span>
                <FileText size={11} />
                <span className="memory-file-name">{shortName}</span>
              </div>
              {isOpen && (
                <div className="memory-content memory-file-content">
                  {renderMarkdown(f.content)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sidebar group for multi-file memory sections ────────────────
function MemorySidebarGroup({ section, badgeClass, selectedMemory, onSelect }: {
  section: any; badgeClass: string; selectedMemory: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const files = section.files as { name: string; path: string; content: string }[] ?? [];

  return (
    <div className="memory-sidebar-group">
      <div
        className="memory-sidebar-group-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="chat-tool-chevron">
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className={`memory-badge ${badgeClass}`}>{section.label}</span>
        <span className="memory-explorer-item-count">{files.length}</span>
      </div>
      {expanded && files.map(f => {
        const shortName = f.path.startsWith(section.path)
          ? f.path.slice(section.path.length).replace(/^\//, '')
          : f.name;
        return (
          <div
            key={f.path}
            className={`memory-explorer-item memory-explorer-subitem ${selectedMemory === f.path ? 'memory-explorer-item-active' : ''}`}
            onClick={() => onSelect(f.path)}
          >
            <FileText size={11} />
            <span className="memory-explorer-item-path">{shortName}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Collapsible long text block ────────────────────────────────
function CollapsibleUserText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = text.split('\n').length;
  const isLong = lineCount > 6 || text.length > 300;

  if (!isLong) return <div className="chat-message-text">{renderMarkdown(text)}</div>;

  return (
    <div className="chat-user-collapsible">
      <div className={`chat-user-text-body chat-message-text ${expanded ? '' : 'chat-user-text-collapsed'}`}>
        {renderMarkdown(text)}
        {!expanded && <span className="chat-user-text-fade" />}
      </div>
      <div className="chat-user-text-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{expanded ? 'Collapse' : `${lineCount} lines — show all`}</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────
export function JobDetail({ job, logs, projectId, onNewJob }: Props) {
  const [tab, setTab] = useState<'chat' | 'output' | 'files' | 'git' | 'memories' | 'cron'>('chat');
  const [fullLogs, setFullLogs] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [fileSearchResults, setFileSearchResults] = useState<{ files: any[]; contentMatches: any[] } | null>(null);
  const [fileSearching, setFileSearching] = useState(false);
  const fileSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [memorySections, setMemorySections] = useState<any[] | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null);
  const [editingMemory, setEditingMemory] = useState<{ filePath: string; content: string } | null>(null);
  const [memorySaving, setMemorySaving] = useState(false);
  const [cronTasks, setCronTasks] = useState<any[]>([]);
  const [cronPath, setCronPath] = useState('');
  const [gitStatus, setGitStatus] = useState<any>(null);
  const [gitSelectedFile, setGitSelectedFile] = useState<string | null>(null);
  const [gitFileDiff, setGitFileDiff] = useState<string>('');
  const [gitCommitMsg, setGitCommitMsg] = useState('');
  const [gitLoading, setGitLoading] = useState(false);
  const [gitActionOutput, setGitActionOutput] = useState<{ ok: boolean; text: string } | null>(null);
  const [gitShowStaged, setGitShowStaged] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Commands for / suggestions — contextual to current job state
  const suggestionCommands = useMemo<CommandDef[]>(() => {
    const cmds: CommandDef[] = [
      {
        id: 'stop',
        label: '/stop',
        description: 'Stop the running job',
        available: () => job.status === 'running' || job.status === 'idle',
        execute: () => api.stopJob(job.id).catch(console.error),
      },
      {
        id: 'archive',
        label: '/archive',
        description: 'Archive this job',
        available: () => job.status === 'completed' || job.status === 'failed',
        execute: () => api.archiveJob(job.id).catch(console.error),
      },
      {
        id: 'clear',
        label: '/clear',
        description: 'Clear the chat display',
        available: () => true,
        execute: () => setFullLogs([]),
      },
      {
        id: 'files',
        label: '/files',
        description: 'Switch to files tab',
        available: () => true,
        execute: () => setTab('files'),
      },
    ];
    if (onNewJob) {
      cmds.push({
        id: 'new',
        label: '/new',
        description: 'Create a new job',
        available: () => true,
        execute: () => onNewJob(),
      });
    }
    return cmds;
  }, [job.id, job.status, onNewJob]);

  // Fetch SDK slash commands from active session (with retry for race condition)
  const [sdkCommands, setSdkCommands] = useState<SDKSlashCommand[]>([]);
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    if (job.status === 'running' || job.status === 'idle') {
      const fetchCommands = (attempt: number) => {
        api.getCommands(job.id)
          .then(cmds => {
            if (cancelled) return;
            if (cmds && cmds.length > 0) {
              setSdkCommands(cmds);
            } else if (attempt < 3) {
              // Server may not have queryHandle ready yet — retry after delay
              retryTimer = setTimeout(() => fetchCommands(attempt + 1), 1500 * attempt);
            }
          })
          .catch(() => { if (!cancelled) setSdkCommands([]); });
      };
      fetchCommands(1);
    } else {
      setSdkCommands([]);
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [job.id, job.status]);

  const handleSdkCommand = useCallback((fullCommand: string) => {
    // Send the slash command as a message to the session
    api.continueJob(job.id, fullCommand).catch(console.error);
  }, [job.id]);

  const suggestions = useSuggestions({
    inputRef,
    value: followUp,
    setValue: setFollowUp,
    projectId,
    commands: suggestionCommands,
    sdkCommands,
    onSdkCommand: handleSdkCommand,
    enabled: true,
  });

  useEffect(() => {
    setFullLogs([]);
    api.getJob(job.id).then(j => setFullLogs(j.logs ?? [])).catch(() => {});
  }, [job.id]);

  const allLogs = useMemo(() => {
    const seen = new Set<string>();
    const result: LogEntry[] = [];
    for (const log of [...fullLogs, ...logs]) {
      const key = `${log.timestamp}|${log.type}|${log.content}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(log);
      }
    }
    return result;
  }, [fullLogs, logs]);

  const chatMessages = useMemo(
    () => groupLogsIntoChatMessages(allLogs, job.status === 'running'),
    [allLogs, job.status],
  );

  // Extract files touched by this job from its tool call logs
  const jobTouchedFiles = useMemo(() => {
    const files = new Set<string>();
    for (const log of allLogs) {
      if (log.type !== 'tool') continue;
      const input = log.meta?.input as Record<string, unknown> | undefined;
      if (!input) continue;
      const name = log.content.replace(/^🔧\s*/, '');
      if ((name === 'Write' || name === 'Edit' || name === 'Read') && typeof input.file_path === 'string') {
        files.add(input.file_path as string);
      }
    }
    return files;
  }, [allLogs]);

  // Auto-scroll
  useEffect(() => {
    const el = tab === 'chat' ? chatRef.current : termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allLogs.length, chatMessages.length, tab]);

  useEffect(() => {
    if (tab === 'files') {
      api.getFiles(projectId).then(setFiles).catch(() => setFiles([]));
    } else if (tab === 'git') {
      refreshGitStatus();
    } else if (tab === 'memories') {
      setEditingMemory(null);
      setSelectedMemory(null);
      api.getMemories(projectId).then((d: any) => {
        const sections = d.sections ?? [];
        setMemorySections(sections);
        // Auto-select the first section
        if (sections.length > 0) setSelectedMemory(sections[0].path);
      }).catch(() => setMemorySections([]));
    } else if (tab === 'cron') {
      api.getCron(projectId, job.id).then((data: any) => {
        setCronTasks(data.tasks ?? []);
        setCronPath(data.path ?? '');
      }).catch(() => { setCronTasks([]); setCronPath(''); });
    }
  }, [tab, projectId, job.id]);

  const handleSaveMemory = async () => {
    if (!editingMemory) return;
    setMemorySaving(true);
    try {
      await api.saveMemory(projectId, editingMemory.filePath, editingMemory.content);
      const data = await api.getMemories(projectId);
      setMemorySections(data.sections ?? []);
      setEditingMemory(null);
    } catch (err) { console.error(err); }
    setMemorySaving(false);
  };

  const handleStop = () => api.stopJob(job.id).catch(console.error);
  const handleArchive = () => api.archiveJob(job.id).catch(console.error);
  const handleCloseSession = () => api.closeSession(job.id).catch(console.error);
  const handleSend = () => {
    if (!followUp.trim() || suggestions.isOpen) return;
    const isSession = job.mode === 'session';
    const isIdle = job.status === 'idle';
    if (isSession && isIdle) {
      api.continueJob(job.id, followUp).then(() => setFollowUp('')).catch(console.error);
    } else {
      api.continueJob(job.id, followUp).then(() => setFollowUp('')).catch(console.error);
    }
  };

  const loadFile = (filePath: string) => {
    api.getFile(projectId, filePath).then(setFileContent).catch(() => setFileContent(null));
  };

  const handleFileSearch = useCallback((query: string) => {
    setFileSearchQuery(query);
    if (fileSearchTimer.current) clearTimeout(fileSearchTimer.current);
    if (!query.trim()) {
      setFileSearchResults(null);
      setFileSearching(false);
      return;
    }
    setFileSearching(true);
    fileSearchTimer.current = setTimeout(() => {
      api.searchFiles(projectId, query)
        .then((results: any) => {
          setFileSearchResults(results);
          setFileSearching(false);
        })
        .catch(() => {
          setFileSearchResults({ files: [], contentMatches: [] });
          setFileSearching(false);
        });
    }, 300); // debounce 300ms
  }, [projectId]);

  const refreshFiles = () => {
    api.getFiles(projectId).then(setFiles).catch(() => setFiles([]));
  };

  // ── Git helpers ──
  const refreshGitStatus = () => {
    setGitLoading(true);
    setGitActionOutput(null);
    api.getGitStatus(projectId).then((data: any) => {
      setGitStatus(data);
      setGitLoading(false);
      // If a file was selected, refresh its diff
      if (gitSelectedFile) {
        loadGitFileDiff(gitSelectedFile, gitShowStaged);
      }
    }).catch(() => { setGitStatus(null); setGitLoading(false); });
  };

  const loadGitFileDiff = (filePath: string, staged: boolean) => {
    setGitSelectedFile(filePath);
    api.getGitDiff(projectId, filePath, staged).then((data: any) => {
      setGitFileDiff(data.diff || '(no changes)');
    }).catch(() => setGitFileDiff('(error loading diff)'));
  };

  const handleGitAction = async (action: string, payload?: { files?: string[]; message?: string }) => {
    setGitLoading(true);
    setGitActionOutput(null);
    try {
      const result = await api.gitAction(projectId, action, payload);
      setGitActionOutput({ ok: true, text: result.output || 'Done' });
      // Refresh status after action
      refreshGitStatus();
    } catch (err: any) {
      setGitActionOutput({ ok: false, text: err.message ?? 'Action failed' });
      setGitLoading(false);
    }
  };

  // Check if a git-relative file path was touched by this job
  const isJobTouchedFile = (relPath: string): boolean => {
    for (const absPath of jobTouchedFiles) {
      if (absPath.endsWith('/' + relPath) || absPath === relPath) return true;
    }
    return false;
  };

  const isRunning = job.status === 'running';
  const isIdle = job.status === 'idle';
  const isSession = job.mode === 'session';
  const canSendMessage = isSession && isIdle;
  const canContinue = (job.status === 'completed' || job.status === 'failed') && !!job.sessionId;
  const showInput = canSendMessage || canContinue;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="detail-header">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className={`badge badge-${job.status}`}>
              {isRunning ? <span className="running-indicator">{job.status}</span>
                : isIdle ? <span className="running-indicator">● session</span>
                : job.status}
            </span>
            <span className="text-sm text-muted font-mono">{job.id.slice(0, 8)}</span>
          </div>
          <div className="flex gap-2">
            {isIdle && isSession && (
              <span className="session-indicator">Session Active</span>
            )}
            {(isRunning || isIdle) && (
              <button className="btn btn-danger btn-sm" onClick={handleStop}>
                <Square size={12} /> Stop
              </button>
            )}
            {isSession && isIdle && (
              <button className="btn btn-sm" onClick={handleCloseSession}>
                Close Session
              </button>
            )}
            {job.status !== 'archived' && !isRunning && !isIdle && (
              <button className="btn btn-sm" onClick={handleArchive}>
                <Archive size={12} /> Archive
              </button>
            )}
          </div>
        </div>
        {(() => {
          const lineCount = job.prompt.split('\n').length;
          const isLong = lineCount > 4 || job.prompt.length > 200;
          return (
            <div className="job-prompt-wrapper">
              <div className={`job-prompt ${isLong && !promptExpanded ? 'job-prompt-collapsed' : ''}`}>
                {job.name && <strong style={{ color: 'var(--accent)', marginRight: 8 }}>{job.name}</strong>}
                {job.prompt}
                {isLong && !promptExpanded && <span className="job-prompt-fade" />}
              </div>
              {isLong && (
                <div className="job-prompt-toggle" onClick={() => setPromptExpanded(!promptExpanded)}>
                  {promptExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span>{promptExpanded ? 'Collapse' : `${lineCount} lines — click to expand`}</span>
                </div>
              )}
            </div>
          );
        })()}
        {job.tokenUsage && (
          <div className="flex gap-3 text-sm text-muted" style={{ marginTop: 8 }}>
            <span>Tokens: {(job.tokenUsage.input + job.tokenUsage.output).toLocaleString()}</span>
            {job.costUsd != null && <span>Cost: ${job.costUsd.toFixed(4)}</span>}
            {job.sessionId && <span>Session: {job.sessionId.slice(0, 8)}</span>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        <div className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
          <span className="flex items-center gap-2"><MessageSquare size={12} /> Chat</span>
        </div>
        <div className={`tab ${tab === 'output' ? 'active' : ''}`} onClick={() => setTab('output')}>
          <span className="flex items-center gap-2"><ScrollText size={12} /> Output</span>
        </div>
        <div className={`tab ${tab === 'files' ? 'active' : ''}`} onClick={() => setTab('files')}>
          <span className="flex items-center gap-2"><FolderTree size={12} /> Files</span>
        </div>
        <div className={`tab ${tab === 'git' ? 'active' : ''}`} onClick={() => setTab('git')}>
          <span className="flex items-center gap-2"><GitBranch size={12} /> Git</span>
        </div>
        <div className={`tab ${tab === 'memories' ? 'active' : ''}`} onClick={() => setTab('memories')}>
          <span className="flex items-center gap-2"><BookOpen size={12} /> Memories</span>
        </div>
        <div className={`tab ${tab === 'cron' ? 'active' : ''}`} onClick={() => setTab('cron')}>
          <span className="flex items-center gap-2"><Clock size={12} /> Cron</span>
        </div>
      </div>

      {/* Body */}
      <div className="detail-body">
        {/* ── Chat tab ── */}
        {tab === 'chat' && (
          <div className="chat-tab-wrapper">
            <div className="chat-container" ref={chatRef}>
              {chatMessages.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: 40 }}>
                  {job.status === 'queued' ? 'Waiting to start...' : 'No messages yet...'}
                </div>
              )}
              {chatMessages.map((msg, i) => {
                const toolParts = msg.parts.filter(p => p.kind === 'tool');
                const lastToolIdx = toolParts.length - 1;
                let toolCounter = 0;
                return (
                  <div key={i} className={`chat-message chat-message-${msg.role} ${msg.isResult ? 'chat-message-result' : ''} ${msg.isError ? 'chat-message-error' : ''}`}>
                    <div className="chat-message-header">
                      <span className="chat-message-role">{msg.role === 'user' ? 'You' : 'Claude'}</span>
                      <span className="chat-message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                    {msg.parts.map((part, j) => {
                      if (part.kind === 'text') {
                        if (msg.role === 'user') {
                          return <CollapsibleUserText key={j} text={part.text} />;
                        }
                        return (
                          <div key={j} className="chat-message-text">
                            {renderMarkdown(part.text)}
                          </div>
                        );
                      }
                      if (part.kind === 'thinking') {
                        return <ThinkingBlock key={j} text={part.text} />;
                      }
                      const currentToolIdx = toolCounter++;
                      return (
                        <div key={j} className="chat-tool-calls">
                          <ToolCallBlock
                            tool={part}
                            isJobRunning={isRunning}
                            isLastInGroup={i === chatMessages.length - 1 && currentToolIdx === lastToolIdx}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {isRunning && (
                <div className="chat-typing">
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                </div>
              )}
            </div>

            {showInput && (
              <div className="chat-input-bar">
                <div className="suggestion-wrapper">
                  <input
                    ref={tab === 'chat' ? inputRef : undefined}
                    className="input flex-1"
                    placeholder={canSendMessage ? 'Type @ for files, / for commands...' : 'Send follow-up prompt... (@ files, / commands)'}
                    value={followUp}
                    onChange={suggestions.handleChange}
                    onKeyDown={e => {
                      suggestions.handleKeyDown(e);
                      if (!e.defaultPrevented && e.key === 'Enter') handleSend();
                    }}
                  />
                  {suggestions.isOpen && tab === 'chat' && (
                    <SuggestionDropdown
                      items={suggestions.items}
                      selectedIndex={suggestions.selectedIndex}
                      onSelect={suggestions.selectItem}
                      onHover={suggestions.setSelectedIndex}
                      position="above"
                      loading={suggestions.loading}
                      triggerType={suggestions.triggerType}
                    />
                  )}
                </div>
                <button className="btn btn-primary" onClick={handleSend} disabled={!followUp.trim()}>
                  <Play size={12} /> {canSendMessage ? 'Send' : 'Continue'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Output tab (raw logs) ── */}
        {tab === 'output' && (
          <div className="output-tab-wrapper">
            <div className="terminal" ref={termRef}>
              {allLogs.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {job.status === 'queued' ? 'Waiting to start...' : 'No output yet...'}
                </div>
              )}
              {allLogs.map((log, i) => (
                <OutputLogLine key={i} log={log} />
              ))}
            </div>

            {showInput && (
              <div className="chat-input-bar">
                <div className="suggestion-wrapper">
                  <input
                    ref={tab === 'output' ? inputRef : undefined}
                    className="input flex-1"
                    placeholder={canSendMessage ? 'Type @ for files, / for commands...' : 'Send follow-up prompt... (@ files, / commands)'}
                    value={followUp}
                    onChange={suggestions.handleChange}
                    onKeyDown={e => {
                      suggestions.handleKeyDown(e);
                      if (!e.defaultPrevented && e.key === 'Enter') handleSend();
                    }}
                  />
                  {suggestions.isOpen && tab === 'output' && (
                    <SuggestionDropdown
                      items={suggestions.items}
                      selectedIndex={suggestions.selectedIndex}
                      onSelect={suggestions.selectItem}
                      onHover={suggestions.setSelectedIndex}
                      position="above"
                      loading={suggestions.loading}
                      triggerType={suggestions.triggerType}
                    />
                  )}
                </div>
                <button className="btn btn-primary" onClick={handleSend} disabled={!followUp.trim()}>
                  <Play size={12} /> {canSendMessage ? 'Send' : 'Continue'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Files tab ── */}
        {tab === 'files' && (
          <div className="file-explorer" style={{ height: '100%' }}>
            {/* Left panel: search + tree */}
            <div className="file-explorer-sidebar">
              <div className="file-explorer-toolbar">
                <div className="file-search-box">
                  <Search size={13} className="file-search-icon" />
                  <input
                    className="file-search-input"
                    placeholder="Search files & content..."
                    value={fileSearchQuery}
                    onChange={e => handleFileSearch(e.target.value)}
                  />
                  {fileSearchQuery && (
                    <X size={13} className="file-search-clear" onClick={() => handleFileSearch('')} />
                  )}
                </div>
                <button className="file-refresh-btn" onClick={refreshFiles} title="Refresh file tree">
                  <RefreshCw size={13} />
                </button>
              </div>

              <div className="file-explorer-tree">
                {fileSearchQuery.trim() ? (
                  // Search results view
                  <div className="file-search-results">
                    {fileSearching && <div className="file-search-status">Searching...</div>}
                    {fileSearchResults && !fileSearching && (
                      <>
                        {fileSearchResults.files.length > 0 && (
                          <div className="file-search-section">
                            <div className="file-search-section-title">
                              <File size={12} /> Files ({fileSearchResults.files.length})
                            </div>
                            {fileSearchResults.files.map((f: any) => (
                              <div
                                key={f.path}
                                className={`file-node file-node-file file-search-result-item ${fileContent?.path === f.path ? 'file-node-active' : ''}`}
                                onClick={() => loadFile(f.path)}
                              >
                                <File size={13} className="file-node-icon" />
                                <span className="file-search-result-path">{f.path}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {fileSearchResults.contentMatches.length > 0 && (
                          <div className="file-search-section">
                            <div className="file-search-section-title">
                              <FileText size={12} /> Content matches ({fileSearchResults.contentMatches.length})
                            </div>
                            {fileSearchResults.contentMatches.map((m: any, i: number) => (
                              <div
                                key={`${m.path}:${m.line}:${i}`}
                                className={`file-search-content-match ${fileContent?.path === m.path ? 'file-node-active' : ''}`}
                                onClick={() => loadFile(m.path)}
                              >
                                <div className="file-search-match-path">
                                  <File size={11} className="file-node-icon" />
                                  {m.path}:{m.line}
                                </div>
                                <div className="file-search-match-text">{m.text}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {fileSearchResults.files.length === 0 && fileSearchResults.contentMatches.length === 0 && (
                          <div className="file-search-status">No results found</div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  // Tree view
                  files.length === 0 ? (
                    <div className="file-search-status">No files found</div>
                  ) : (
                    <FileTree nodes={files} onSelect={loadFile} selectedPath={fileContent?.path} />
                  )
                )}
              </div>
            </div>

            {/* Right panel: file content */}
            <div className="file-explorer-content">
              {fileContent ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="file-content-header">
                    <span className="file-content-path">{fileContent.path}</span>
                  </div>
                  <pre className="terminal file-content-body" style={{ whiteSpace: 'pre-wrap' }}>
                    {fileContent.content}
                  </pre>
                </div>
              ) : (
                <div className="file-content-empty">
                  <FileText size={32} style={{ opacity: 0.3 }} />
                  <div>Select a file to view</div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* ── Git tab ── */}
        {tab === 'git' && (
          <div className="git-panel" style={{ height: '100%' }}>
            {gitStatus === null ? (
              <div className="git-empty">
                {gitLoading ? 'Loading git status...' : 'Unable to load git status'}
              </div>
            ) : !gitStatus.isGitRepo ? (
              <div className="git-empty">
                <GitBranch size={32} style={{ opacity: 0.3 }} />
                <div>Not a git repository</div>
              </div>
            ) : (
              <>
                {/* Git toolbar */}
                <div className="git-toolbar">
                  <div className="git-toolbar-left">
                    <span className="git-branch-badge">
                      <GitBranch size={12} /> {gitStatus.branch}
                    </span>
                    {gitStatus.ahead > 0 && <span className="git-sync-badge git-ahead">↑{gitStatus.ahead}</span>}
                    {gitStatus.behind > 0 && <span className="git-sync-badge git-behind">↓{gitStatus.behind}</span>}
                    <div className="git-toggle-group">
                      <button
                        className={`git-toggle-btn ${!gitShowStaged ? 'active' : ''}`}
                        onClick={() => { setGitShowStaged(false); if (gitSelectedFile) loadGitFileDiff(gitSelectedFile, false); }}
                      >Working</button>
                      <button
                        className={`git-toggle-btn ${gitShowStaged ? 'active' : ''}`}
                        onClick={() => { setGitShowStaged(true); if (gitSelectedFile) loadGitFileDiff(gitSelectedFile, true); }}
                      >Staged</button>
                    </div>
                  </div>
                  <div className="git-toolbar-right">
                    <button className="btn btn-sm" onClick={() => handleGitAction('add_all')} title="Stage all changes">
                      <Plus size={12} /> Stage All
                    </button>
                    <button className="btn btn-sm" onClick={() => handleGitAction('pull')} title="Git pull">
                      <Download size={12} /> Pull
                    </button>
                    <button className="btn btn-sm" onClick={() => handleGitAction('push')} title="Git push">
                      <Upload size={12} /> Push
                    </button>
                    <button className="git-refresh-btn" onClick={refreshGitStatus} title="Refresh">
                      <RefreshCw size={13} />
                    </button>
                  </div>
                </div>

                {/* Action output notification */}
                {gitActionOutput && (
                  <div className={`git-action-output ${gitActionOutput.ok ? 'git-action-ok' : 'git-action-err'}`}>
                    <span>{gitActionOutput.text}</span>
                    <X size={12} className="git-action-close" onClick={() => setGitActionOutput(null)} />
                  </div>
                )}

                {/* Main content: file list + diff */}
                <div className="git-content">
                  {/* Left: changed files list */}
                  <div className="git-file-list">
                    {/* Staged files */}
                    {gitStatus.staged.length > 0 && (
                      <div className="git-section">
                        <div className="git-section-title">
                          <Check size={12} /> Staged ({gitStatus.staged.length})
                        </div>
                        {gitStatus.staged.map((f: any) => {
                          const touched = isJobTouchedFile(f.path);
                          return (
                            <div
                              key={`staged-${f.path}`}
                              className={`git-file-item ${gitSelectedFile === f.path && gitShowStaged ? 'git-file-active' : ''} ${touched ? 'git-file-job-touched' : ''}`}
                              onClick={() => { setGitShowStaged(true); loadGitFileDiff(f.path, true); }}
                            >
                              <span className="git-file-status git-status-staged">{f.status}</span>
                              {touched && <span title="Modified by this job"><Star size={10} className="git-job-marker" /></span>}
                              <span className="git-file-path" title={f.path}>{f.path}</span>
                              <button
                                className="git-file-action"
                                onClick={e => { e.stopPropagation(); handleGitAction('discard', { files: [f.path] }); }}
                                title="Unstage (discard)"
                              >
                                <Undo2 size={11} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Unstaged (modified) files */}
                    {gitStatus.unstaged.length > 0 && (
                      <div className="git-section">
                        <div className="git-section-title">
                          <Edit3 size={12} /> Modified ({gitStatus.unstaged.length})
                        </div>
                        {gitStatus.unstaged.map((f: any) => {
                          const touched = isJobTouchedFile(f.path);
                          return (
                            <div
                              key={`unstaged-${f.path}`}
                              className={`git-file-item ${gitSelectedFile === f.path && !gitShowStaged ? 'git-file-active' : ''} ${touched ? 'git-file-job-touched' : ''}`}
                              onClick={() => { setGitShowStaged(false); loadGitFileDiff(f.path, false); }}
                            >
                              <span className="git-file-status git-status-modified">{f.status}</span>
                              {touched && <span title="Modified by this job"><Star size={10} className="git-job-marker" /></span>}
                              <span className="git-file-path" title={f.path}>{f.path}</span>
                              <div className="git-file-actions">
                                <button
                                  className="git-file-action"
                                  onClick={e => { e.stopPropagation(); handleGitAction('add', { files: [f.path] }); }}
                                  title="Stage file"
                                >
                                  <Plus size={11} />
                                </button>
                                <button
                                  className="git-file-action git-file-action-danger"
                                  onClick={e => { e.stopPropagation(); handleGitAction('discard', { files: [f.path] }); }}
                                  title="Discard changes"
                                >
                                  <Undo2 size={11} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Untracked files */}
                    {gitStatus.untracked.length > 0 && (
                      <div className="git-section">
                        <div className="git-section-title">
                          <File size={12} /> Untracked ({gitStatus.untracked.length})
                        </div>
                        {gitStatus.untracked.map((filePath: string) => {
                          const touched = isJobTouchedFile(filePath);
                          return (
                            <div
                              key={`untracked-${filePath}`}
                              className={`git-file-item ${touched ? 'git-file-job-touched' : ''}`}
                            >
                              <span className="git-file-status git-status-untracked">?</span>
                              {touched && <span title="Created by this job"><Star size={10} className="git-job-marker" /></span>}
                              <span className="git-file-path" title={filePath}>{filePath}</span>
                              <button
                                className="git-file-action"
                                onClick={e => { e.stopPropagation(); handleGitAction('add', { files: [filePath] }); }}
                                title="Stage file"
                              >
                                <Plus size={11} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {gitStatus.staged.length === 0 && gitStatus.unstaged.length === 0 && gitStatus.untracked.length === 0 && (
                      <div className="git-empty-small">No changes detected</div>
                    )}

                    {/* Job touched files legend */}
                    {jobTouchedFiles.size > 0 && (
                      <div className="git-legend">
                        <Star size={10} className="git-job-marker" />
                        <span>= touched by this job</span>
                      </div>
                    )}
                  </div>

                  {/* Right: diff viewer */}
                  <div className="git-diff-panel">
                    {gitSelectedFile ? (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div className="git-diff-header">
                          <span className="git-diff-filename">{gitSelectedFile}</span>
                          {isJobTouchedFile(gitSelectedFile) && (
                            <span className="git-diff-job-badge">
                              <Star size={10} /> this job
                            </span>
                          )}
                        </div>
                        <pre className="git-diff-body">
                          {gitFileDiff.split('\n').map((line, i) => {
                            let cls = 'git-diff-line';
                            if (line.startsWith('+') && !line.startsWith('+++')) cls += ' git-diff-add';
                            else if (line.startsWith('-') && !line.startsWith('---')) cls += ' git-diff-del';
                            else if (line.startsWith('@@')) cls += ' git-diff-hunk';
                            else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) cls += ' git-diff-meta';
                            return <div key={i} className={cls}>{line || ' '}</div>;
                          })}
                        </pre>
                      </div>
                    ) : (
                      <div className="git-empty">
                        <GitBranch size={32} style={{ opacity: 0.3 }} />
                        <div>Select a file to view diff</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Commit bar */}
                <div className="git-commit-bar">
                  <input
                    className="git-commit-input"
                    placeholder="Commit message..."
                    value={gitCommitMsg}
                    onChange={e => setGitCommitMsg(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && gitCommitMsg.trim()) {
                        handleGitAction('commit', { message: gitCommitMsg.trim() });
                        setGitCommitMsg('');
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!gitCommitMsg.trim() || gitStatus.staged.length === 0}
                    onClick={() => {
                      if (gitCommitMsg.trim()) {
                        handleGitAction('commit', { message: gitCommitMsg.trim() });
                        setGitCommitMsg('');
                      }
                    }}
                  >
                    <Check size={12} /> Commit
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={gitStatus.ahead === 0}
                    onClick={() => handleGitAction('push')}
                  >
                    <Upload size={12} /> Push
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Memories tab (two-column layout like files) ── */}
        {tab === 'memories' && (
          <div className="memory-explorer" style={{ height: '100%' }}>
            {/* Left panel: section list */}
            <div className="memory-explorer-sidebar">
              <div className="memory-explorer-header">
                <BookOpen size={13} />
                <span>Memory Files</span>
              </div>
              <div className="memory-explorer-list">
                {memorySections === null ? (
                  <div className="memory-explorer-empty">Loading...</div>
                ) : memorySections.length === 0 ? (
                  <div className="memory-explorer-empty">No memory files found.</div>
                ) : (
                  memorySections.map((sec: any) => {
                    const badgeClass = sec.level.startsWith('user') ? 'memory-badge-user'
                      : sec.level === 'auto-memory' ? 'memory-badge-auto'
                      : sec.level === 'local' ? 'memory-badge-local'
                      : 'memory-badge-project';
                    const isMultiFile = sec.files && sec.files.length > 0;
                    const isSelected = selectedMemory === sec.path;

                    if (isMultiFile) {
                      // Multi-file sections expand to show individual files
                      return (
                        <MemorySidebarGroup
                          key={sec.path}
                          section={sec}
                          badgeClass={badgeClass}
                          selectedMemory={selectedMemory}
                          onSelect={(path: string) => { setSelectedMemory(path); setEditingMemory(null); }}
                        />
                      );
                    }

                    return (
                      <div
                        key={sec.path}
                        className={`memory-explorer-item ${isSelected ? 'memory-explorer-item-active' : ''}`}
                        onClick={() => { setSelectedMemory(sec.path); setEditingMemory(null); }}
                      >
                        <span className={`memory-badge ${badgeClass}`}>{sec.label}</span>
                        <span className="memory-explorer-item-path" title={sec.path}>
                          {sec.path.split('/').pop() || sec.path}
                        </span>
                        {sec.editable && <Edit3 size={10} className="memory-explorer-item-editable" />}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right panel: selected content */}
            <div className="memory-explorer-content">
              {(() => {
                if (!selectedMemory || !memorySections) {
                  return (
                    <div className="memory-content-empty">
                      <BookOpen size={32} style={{ opacity: 0.3 }} />
                      <div>Select a memory file to view</div>
                    </div>
                  );
                }

                // Find the section + optional sub-file
                let sec: any = null;
                let subFile: any = null;
                for (const s of memorySections) {
                  if (s.path === selectedMemory) { sec = s; break; }
                  if (s.files) {
                    const f = s.files.find((f: any) => f.path === selectedMemory);
                    if (f) { sec = s; subFile = f; break; }
                  }
                }
                if (!sec) {
                  return (
                    <div className="memory-content-empty">
                      <BookOpen size={32} style={{ opacity: 0.3 }} />
                      <div>Select a memory file to view</div>
                    </div>
                  );
                }

                const badgeClass = sec.level.startsWith('user') ? 'memory-badge-user'
                  : sec.level === 'auto-memory' ? 'memory-badge-auto'
                  : sec.level === 'local' ? 'memory-badge-local'
                  : 'memory-badge-project';

                const filePath = subFile ? subFile.path : sec.path;
                const content = subFile ? subFile.content : sec.content;
                const editable = subFile ? false : sec.editable;
                const isEditing = editingMemory?.filePath === filePath;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div className="memory-content-header">
                      <div className="memory-content-header-left">
                        <span className={`memory-badge ${badgeClass}`}>{sec.label}</span>
                        <span className="memory-content-path">{filePath}</span>
                      </div>
                      <div className="memory-content-header-actions">
                        {editable && !isEditing && (
                          <button className="btn btn-sm" onClick={() => setEditingMemory({ filePath, content: content ?? '' })}>
                            <Edit3 size={11} /> Edit
                          </button>
                        )}
                        {isEditing && (
                          <>
                            <button className="btn btn-primary btn-sm" onClick={handleSaveMemory} disabled={memorySaving}>
                              <Save size={11} /> {memorySaving ? 'Saving...' : 'Save'}
                            </button>
                            <button className="btn btn-sm" onClick={() => setEditingMemory(null)}>
                              <X size={11} /> Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <textarea
                        className="memory-editor-panel"
                        value={editingMemory!.content}
                        onChange={e => setEditingMemory({ ...editingMemory!, content: e.target.value })}
                        spellCheck={false}
                      />
                    ) : (
                      <div className="memory-content-body">
                        {content ? renderMarkdown(content) : (
                          <span className="text-muted" style={{ fontStyle: 'italic' }}>
                            No file found. {editable ? 'Click Edit to create one.' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Cron tab ── */}
        {tab === 'cron' && (
          <div className="cron-container">
            {cronPath && <div className="cron-path">{cronPath}</div>}
            {cronTasks.length === 0 ? (
              <div className="text-sm text-muted" style={{ fontStyle: 'italic', padding: 20, textAlign: 'center' }}>
                No scheduled tasks found.
              </div>
            ) : (
              <div className="cron-list">
                {cronTasks.map((task: any, i: number) => (
                  <div key={task.id ?? i} className={`cron-item ${task.recurring === false ? 'cron-oneshot' : ''}`}>
                    <div className="cron-item-header">
                      <span className="cron-expr">{task.cron ?? '—'}</span>
                      <span className={`cron-type-badge ${task.recurring === false ? 'cron-type-once' : 'cron-type-recurring'}`}>
                        {task.recurring === false ? 'once' : 'recurring'}
                      </span>
                      {task.durable && <span className="cron-durable-badge">durable</span>}
                      {task.source === 'session' && <span className="cron-session-badge">session</span>}
                      {task.id && <span className="cron-id">{task.id.slice(0, 8)}</span>}
                    </div>
                    <div className="cron-prompt">{task.prompt ?? '(no prompt)'}</div>
                    {task.lastRun && (
                      <div className="cron-meta">Last run: {new Date(task.lastRun).toLocaleString()}</div>
                    )}
                    {task.nextRun && (
                      <div className="cron-meta">Next run: {new Date(task.nextRun).toLocaleString()}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FileTreeNode({ node, onSelect, selectedPath, depth = 0 }: { node: any; onSelect: (p: string) => void; selectedPath?: string; depth?: number }) {
  const [expanded, setExpanded] = useState(depth === 0); // only top-level dirs expanded by default

  if (!node.isDir) {
    return (
      <div
        className={`file-node file-node-file ${selectedPath === node.path ? 'file-node-active' : ''}`}
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <File size={13} className="file-node-icon" />
        <span className="file-node-name">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="file-node file-node-dir"
        onClick={() => setExpanded(!expanded)}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        <ChevronRight size={12} className={`file-node-chevron ${expanded ? 'file-node-chevron-open' : ''}`} />
        {expanded ? <FolderOpen size={13} className="file-node-icon file-node-icon-dir" /> : <Folder size={13} className="file-node-icon file-node-icon-dir" />}
        <span className="file-node-name">{node.name}</span>
        {node.children && <span className="file-node-count">{node.children.length}</span>}
      </div>
      {expanded && node.children && (
        <div>
          {node.children.map((child: any) => (
            <FileTreeNode key={child.path} node={child} onSelect={onSelect} selectedPath={selectedPath} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTree({ nodes, onSelect, selectedPath }: { nodes: any[]; onSelect: (p: string) => void; selectedPath?: string }) {
  return (
    <div className="file-tree">
      {nodes.map((n: any) => (
        <FileTreeNode key={n.path} node={n} onSelect={onSelect} selectedPath={selectedPath} depth={0} />
      ))}
    </div>
  );
}
