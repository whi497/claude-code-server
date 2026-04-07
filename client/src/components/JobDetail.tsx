import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../hooks/api';
import type { Job, LogEntry } from '../types';
import { Square, Archive, Play, FolderTree, ScrollText, MessageSquare, ChevronDown, ChevronRight, Wrench, Terminal, FileText, Search, Edit3, PenTool, Globe, Bot, FileCode, Copy, BookOpen, Clock, Save, X } from 'lucide-react';
import { renderInline, isTableRow, isTableSeparator, renderTable, renderMarkdown } from './Markdown';

interface Props {
  job: Job;
  logs: LogEntry[];
  projectId: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Chat message grouping (ordered parts) ────────────────────
type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; input: unknown; result?: string; id?: string };

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

  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };

  for (const log of logs) {
    if (log.type === 'system') continue;

    if (log.type === 'user') {
      flush();
      current = { role: 'user', parts: [{ kind: 'text', text: log.content }], timestamp: log.timestamp };
      flush();
      continue;
    }

    if (log.type === 'text') {
      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', parts: [], timestamp: log.timestamp };
      }
      // Append to last text part if exists, otherwise create new one
      const lastPart = current.parts[current.parts.length - 1];
      if (lastPart && lastPart.kind === 'text') {
        lastPart.text += '\n' + log.content;
      } else {
        current.parts.push({ kind: 'text', text: log.content });
      }
    } else if (log.type === 'tool') {
      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', parts: [], timestamp: log.timestamp };
      }
      const toolName = log.content.replace(/^🔧\s*/, '');
      current.parts.push({ kind: 'tool', name: toolName, input: log.meta?.input, id: log.meta?.tool_use_id as string });
    } else if (log.type === 'tool_result') {
      // Attach result to the last tool part in current message
      if (current) {
        for (let j = current.parts.length - 1; j >= 0; j--) {
          const p = current.parts[j];
          if (p.kind === 'tool' && !p.result) {
            p.result = log.content;
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
  return messages;
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

// ── ToolCall collapsible block ─────────────────────────────────
function ToolCallBlock({ tool, isJobRunning, isLastInGroup }: { tool: { name: string; input: unknown; result?: string }; isJobRunning: boolean; isLastInGroup: boolean }) {
  const isActive = isJobRunning && isLastInGroup && !tool.result;
  const defaultOpen = tool.name === 'TodoWrite' || tool.name === 'Edit' || tool.name === 'Write';
  const [expanded, setExpanded] = useState(isActive || defaultOpen);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (isActive) setExpanded(true);
    else if (tool.result !== undefined && !defaultOpen) setExpanded(false);
  }, [isActive, tool.result, defaultOpen]);

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
  };

  return (
    <div className={`chat-tool-block ${isActive ? 'active' : ''}`}>
      <div className="chat-tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="chat-tool-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {icon}
        <span className="chat-tool-name">{tool.name}</span>
        {summary && <span className="chat-tool-summary">{summary}</span>}
        {isActive && <span className="chat-tool-spinner" />}
        {!isActive && tool.result !== undefined && <span className="chat-tool-done">done</span>}
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
        {expanded && log.meta?.input && (
          <pre className="log-expanded-content" onClick={e => e.stopPropagation()}>
            {typeof log.meta.input === 'string' ? log.meta.input : JSON.stringify(log.meta.input, null, 2)}
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
export function JobDetail({ job, logs, projectId }: Props) {
  const [tab, setTab] = useState<'chat' | 'output' | 'files' | 'memories' | 'cron'>('chat');
  const [fullLogs, setFullLogs] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [memorySections, setMemorySections] = useState<any[] | null>(null);
  const [editingMemory, setEditingMemory] = useState<{ filePath: string; content: string } | null>(null);
  const [memorySaving, setMemorySaving] = useState(false);
  const [cronTasks, setCronTasks] = useState<any[]>([]);
  const [cronPath, setCronPath] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll
  useEffect(() => {
    const el = tab === 'chat' ? chatRef.current : termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allLogs.length, chatMessages.length, tab]);

  useEffect(() => {
    if (tab === 'files') {
      api.getFiles(projectId).then(setFiles).catch(() => setFiles([]));
    } else if (tab === 'memories') {
      setEditingMemory(null);
      api.getMemories(projectId).then((d: any) => setMemorySections(d.sections ?? [])).catch(() => setMemorySections([]));
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
    if (!followUp.trim()) return;
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
                <input
                  className="input flex-1"
                  placeholder={canSendMessage ? 'Send message to session...' : 'Send follow-up prompt...'}
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                />
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
                <input
                  className="input flex-1"
                  placeholder={canSendMessage ? 'Send message to session...' : 'Send follow-up prompt to continue session...'}
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                />
                <button className="btn btn-primary" onClick={handleSend} disabled={!followUp.trim()}>
                  <Play size={12} /> {canSendMessage ? 'Send' : 'Continue'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Files tab ── */}
        {tab === 'files' && (
          <div className="flex gap-4" style={{ height: '100%' }}>
            <div style={{ width: 240, overflow: 'auto' }}>
              <FileTree nodes={files} onSelect={loadFile} />
            </div>
            <div style={{ flex: 1 }}>
              {fileContent ? (
                <div>
                  <div className="text-sm font-mono text-muted mb-2">{fileContent.path}</div>
                  <pre className="terminal" style={{ maxHeight: '50vh', whiteSpace: 'pre-wrap' }}>
                    {fileContent.content}
                  </pre>
                </div>
              ) : (
                <div className="text-sm text-muted">Select a file to view</div>
              )}
            </div>
          </div>
        )}
        {/* ── Memories tab ── */}
        {tab === 'memories' && (
          <div className="memories-container">
            {memorySections === null ? (
              <div className="text-sm text-muted" style={{ fontStyle: 'italic' }}>Loading...</div>
            ) : memorySections.length === 0 ? (
              <div className="text-sm text-muted" style={{ fontStyle: 'italic', textAlign: 'center', padding: 40 }}>
                No memory files found.
              </div>
            ) : (
              memorySections.map((sec: any) => {
                const isEditing = editingMemory?.filePath === sec.path;
                const badgeClass = sec.level.startsWith('user') ? 'memory-badge-user'
                  : sec.level === 'auto-memory' ? 'memory-badge-auto'
                  : sec.level === 'local' ? 'memory-badge-local'
                  : 'memory-badge-project';

                // Single-file section (CLAUDE.md)
                if (sec.content !== null || (!sec.files && sec.editable)) {
                  return (
                    <div key={sec.path} className="memory-section">
                      <div className="memory-header">
                        <div className="memory-level">
                          <span className={`memory-badge ${badgeClass}`}>{sec.label}</span>
                          <span className="memory-path">{sec.path}</span>
                        </div>
                        {sec.editable && !isEditing && (
                          <button className="btn btn-sm" onClick={() => setEditingMemory({ filePath: sec.path, content: sec.content ?? '' })}>
                            <Edit3 size={11} /> Edit
                          </button>
                        )}
                        {isEditing && (
                          <div className="flex gap-2">
                            <button className="btn btn-primary btn-sm" onClick={handleSaveMemory} disabled={memorySaving}>
                              <Save size={11} /> {memorySaving ? 'Saving...' : 'Save'}
                            </button>
                            <button className="btn btn-sm" onClick={() => setEditingMemory(null)}>
                              <X size={11} /> Cancel
                            </button>
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <textarea
                          className="memory-editor"
                          value={editingMemory.content}
                          onChange={e => setEditingMemory({ ...editingMemory, content: e.target.value })}
                          spellCheck={false}
                        />
                      ) : (
                        <div className="memory-content">
                          {sec.content ? renderMarkdown(sec.content) : (
                            <span className="text-muted" style={{ fontStyle: 'italic' }}>
                              No file found. {sec.editable ? 'Click Edit to create one.' : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                // Multi-file section (rules/, auto-memory/)
                return (
                  <MemoryFilesSection key={sec.path} section={sec} badgeClass={badgeClass} />
                );
              })
            )}
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

function FileTree({ nodes, onSelect, depth = 0 }: { nodes: any[]; onSelect: (p: string) => void; depth?: number }) {
  return (
    <div style={{ paddingLeft: depth * 12 }}>
      {nodes.map((n: any) => (
        <div key={n.path}>
          <div
            className="file-node"
            onClick={() => !n.isDir && onSelect(n.path)}
            style={{ opacity: n.isDir ? 0.7 : 1, fontWeight: n.isDir ? 500 : 400 }}
          >
            {n.isDir ? '📁' : '📄'} {n.name}
          </div>
          {n.isDir && n.children && <FileTree nodes={n.children} onSelect={onSelect} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}
