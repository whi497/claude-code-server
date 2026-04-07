import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../hooks/api';
import type { Job, LogEntry } from '../types';
import { Square, Archive, Play, FolderTree, ScrollText, MessageSquare, ChevronDown, ChevronRight, Wrench } from 'lucide-react';

interface Props {
  job: Job;
  logs: LogEntry[];
  projectId: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Chat message grouping ──────────────────────────────────────
interface ChatMessage {
  role: 'assistant' | 'user';
  text: string;
  toolCalls: { name: string; input: unknown; result?: string; id?: string }[];
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
    if (log.type === 'system') continue; // hide system messages

    if (log.type === 'user') {
      flush();
      current = { role: 'user', text: log.content, toolCalls: [], timestamp: log.timestamp };
      flush();
      continue;
    }

    if (log.type === 'text') {
      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', text: '', toolCalls: [], timestamp: log.timestamp };
      }
      current.text += (current.text ? '\n' : '') + log.content;
    } else if (log.type === 'tool') {
      if (!current || current.role !== 'assistant' || current.isResult) {
        flush();
        current = { role: 'assistant', text: '', toolCalls: [], timestamp: log.timestamp };
      }
      const toolName = log.content.replace(/^🔧\s*/, '');
      current.toolCalls.push({ name: toolName, input: log.meta?.input, id: log.meta?.tool_use_id as string });
    } else if (log.type === 'tool_result') {
      // Attach result to the last matching tool call
      if (current && current.toolCalls.length > 0) {
        const lastTool = current.toolCalls[current.toolCalls.length - 1];
        if (!lastTool.result) {
          lastTool.result = log.content;
        }
      }
    } else if (log.type === 'result') {
      flush();
      current = { role: 'assistant', text: log.content, toolCalls: [], timestamp: log.timestamp, isResult: true };
    } else if (log.type === 'error') {
      flush();
      current = { role: 'assistant', text: log.content, toolCalls: [], timestamp: log.timestamp, isError: true };
    }
  }
  flush();
  return messages;
}

// ── ToolCall collapsible block ─────────────────────────────────
function ToolCallBlock({ tool, isJobRunning, isLastInGroup }: { tool: { name: string; input: unknown; result?: string }; isJobRunning: boolean; isLastInGroup: boolean }) {
  const isActive = isJobRunning && isLastInGroup && !tool.result;
  const [expanded, setExpanded] = useState(isActive);

  // Auto-expand when active, auto-collapse when done
  useEffect(() => {
    if (isActive) setExpanded(true);
    else if (tool.result !== undefined) setExpanded(false);
  }, [isActive, tool.result]);

  const inputStr = typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2);
  const truncatedResult = tool.result && tool.result.length > 500
    ? tool.result.slice(0, 500) + '...'
    : tool.result;

  return (
    <div className={`chat-tool-block ${isActive ? 'active' : ''}`}>
      <div className="chat-tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="chat-tool-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Wrench size={12} />
        <span className="chat-tool-name">{tool.name}</span>
        {isActive && <span className="chat-tool-spinner" />}
        {!isActive && tool.result !== undefined && <span className="chat-tool-done">done</span>}
      </div>
      {expanded && (
        <div className="chat-tool-body">
          <div className="chat-tool-section">
            <div className="chat-tool-label">Input</div>
            <pre className="chat-tool-code">{inputStr}</pre>
          </div>
          {tool.result !== undefined && (
            <div className="chat-tool-section">
              <div className="chat-tool-label">Output</div>
              <pre className="chat-tool-code">{truncatedResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Simple markdown-like renderer ──────────────────────────────
function renderText(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  const flushCode = () => {
    if (codeLines.length > 0) {
      elements.push(
        <pre key={elements.length} className="chat-code-block">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      codeLines = [];
    }
    inCodeBlock = false;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Inline code
    const processed = line.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
    // Bold
    const bolded = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    if (line.startsWith('# ')) {
      elements.push(<h3 key={elements.length} className="chat-heading" dangerouslySetInnerHTML={{ __html: bolded.slice(2) }} />);
    } else if (line.startsWith('## ')) {
      elements.push(<h4 key={elements.length} className="chat-heading" dangerouslySetInnerHTML={{ __html: bolded.slice(3) }} />);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<div key={elements.length} className="chat-list-item" dangerouslySetInnerHTML={{ __html: '&bull; ' + bolded.slice(2) }} />);
    } else if (line.trim() === '') {
      elements.push(<div key={elements.length} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={elements.length} className="chat-paragraph" dangerouslySetInnerHTML={{ __html: bolded }} />);
    }
  }

  if (inCodeBlock) flushCode();
  return <>{elements}</>;
}

// ── Main component ─────────────────────────────────────────────
export function JobDetail({ job, logs, projectId }: Props) {
  const [tab, setTab] = useState<'chat' | 'output' | 'files'>('chat');
  const [fullLogs, setFullLogs] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [fileContent, setFileContent] = useState<{ path: string; content: string } | null>(null);
  const [followUp, setFollowUp] = useState('');
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
    }
  }, [tab, projectId]);

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
  const canContinue = !isSession && (job.status === 'completed' || job.status === 'failed') && !!job.sessionId;
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
        <div className="font-mono text-sm" style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
          {job.prompt}
        </div>
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
      </div>

      {/* Body */}
      <div className="detail-body">
        {/* ── Chat tab ── */}
        {tab === 'chat' && (
          <>
            <div className="chat-container" ref={chatRef}>
              {chatMessages.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: 40 }}>
                  {job.status === 'queued' ? 'Waiting to start...' : 'No messages yet...'}
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-message chat-message-${msg.role} ${msg.isResult ? 'chat-message-result' : ''} ${msg.isError ? 'chat-message-error' : ''}`}>
                  <div className="chat-message-header">
                    <span className="chat-message-role">{msg.role === 'user' ? 'You' : 'Claude'}</span>
                    <span className="chat-message-time">{formatTime(msg.timestamp)}</span>
                  </div>
                  {msg.text && (
                    <div className="chat-message-text">
                      {renderText(msg.text)}
                    </div>
                  )}
                  {msg.toolCalls.length > 0 && (
                    <div className="chat-tool-calls">
                      {msg.toolCalls.map((tool, j) => (
                        <ToolCallBlock
                          key={j}
                          tool={tool}
                          isJobRunning={isRunning}
                          isLastInGroup={i === chatMessages.length - 1 && j === msg.toolCalls.length - 1}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {isRunning && (
                <div className="chat-typing">
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                </div>
              )}
            </div>

            {showInput && (
              <div className="flex gap-2" style={{ marginTop: 12 }}>
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
          </>
        )}

        {/* ── Output tab (raw logs) ── */}
        {tab === 'output' && (
          <>
            <div className="terminal" ref={termRef}>
              {allLogs.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {job.status === 'queued' ? 'Waiting to start...' : 'No output yet...'}
                </div>
              )}
              {allLogs.map((log, i) => (
                <div key={i} className={`log-line log-${log.type}`}>
                  <span className="ts">{formatTime(log.timestamp)}</span>
                  <span className="content">{log.content}</span>
                </div>
              ))}
            </div>

            {showInput && (
              <div className="flex gap-2" style={{ marginTop: 12 }}>
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
          </>
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
