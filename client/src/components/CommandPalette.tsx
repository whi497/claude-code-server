import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, ArrowUp, ArrowDown, CornerDownLeft, X, MessageSquare, FileText, Hash } from 'lucide-react';
import { api } from '../hooks/api';
import type { Job, Project, LogEntry } from '../types';

interface Props {
  jobs: Job[];
  projects: Project[];
  jobLogs: Record<string, LogEntry[]>;
  onSelectJob: (projectId: string, jobId: string) => void;
  onClose: () => void;
}

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

// Client-side fuzzy scoring for instant results
function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q.length) return 0;

  const substringIdx = t.indexOf(q);
  if (substringIdx !== -1) {
    return 1000 + (100 - Math.min(substringIdx, 99));
  }

  let ti = 0, qi = 0, score = 0, consecutive = 0;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      score += 10 + consecutive * 5;
      if (ti === 0 || /[\s\-_./]/.test(text[ti - 1])) score += 15;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
    ti++;
  }
  return qi === q.length ? score : 0;
}

// Highlight matched characters in text
function highlightMatch(text: string, query: string): JSX.Element {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();

  // Try substring match first
  const idx = lower.indexOf(qLower);
  if (idx !== -1) {
    return (
      <>
        {text.slice(0, idx)}
        <span className="cmd-palette-match">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  }

  // Fuzzy highlight
  const parts: JSX.Element[] = [];
  let qi = 0;
  for (let i = 0; i < text.length && qi < qLower.length; i++) {
    if (lower[i] === qLower[qi]) {
      parts.push(<span key={`b-${i}`}>{text.slice(parts.length ? 0 : 0, 0)}</span>);
      qi++;
    }
  }

  // Simpler: just mark each matching character
  const result: (JSX.Element | string)[] = [];
  qi = 0;
  let lastIdx = 0;
  for (let i = 0; i < text.length && qi < qLower.length; i++) {
    if (lower[i] === qLower[qi]) {
      if (i > lastIdx) result.push(text.slice(lastIdx, i));
      result.push(<span key={i} className="cmd-palette-match">{text[i]}</span>);
      lastIdx = i + 1;
      qi++;
    }
  }
  if (lastIdx < text.length) result.push(text.slice(lastIdx));
  return <>{result}</>;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function CommandPalette({ jobs, projects, jobLogs, onSelectJob, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [serverResults, setServerResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<any>(null);

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // Client-side instant fuzzy results (from store.jobs + store.jobLogs)
  const clientResults = useMemo(() => {
    if (!query.trim()) {
      // Show recent jobs when no query
      return jobs
        .filter(j => j.status !== 'archived')
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 20)
        .map(j => ({
          jobId: j.id,
          projectId: j.projectId,
          jobName: j.name,
          prompt: j.prompt,
          status: j.status,
          mode: j.mode,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
          costUsd: j.costUsd,
          matchField: 'prompt' as const,
          score: 0,
        }));
    }

    const q = query.trim().toLowerCase();
    const scored: (SearchResult & { sortKey: number })[] = [];

    for (const job of jobs) {
      if (job.status === 'archived') continue;

      let bestScore = 0;
      let matchField: 'name' | 'prompt' | 'log' = 'prompt';
      let matchPreview: string | undefined;
      const project = projectMap.get(job.projectId);

      // Score name (highest priority)
      if (job.name) {
        const s = fuzzyScore(job.name, q);
        if (s > bestScore) { bestScore = s + 500; matchField = 'name'; }
      }

      // Score prompt
      const ps = fuzzyScore(job.prompt, q);
      if (ps > bestScore) { bestScore = ps + 200; matchField = 'prompt'; }

      // Score project name
      if (project) {
        const projScore = fuzzyScore(project.name, q);
        if (projScore > bestScore) { bestScore = projScore + 100; matchField = 'prompt'; }
      }

      // Search through live WebSocket-streamed logs (store.jobLogs)
      const logs = jobLogs[job.id];
      if (logs && logs.length > 0) {
        for (const log of logs) {
          if (log.type === 'tool_result') continue; // skip large tool results
          const logLower = log.content.toLowerCase();
          const idx = logLower.indexOf(q);
          if (idx !== -1) {
            const logScore = 150; // log match score
            if (logScore > bestScore) {
              bestScore = logScore;
              matchField = 'log';
            }
            // Always capture the preview for log matches
            if (!matchPreview) {
              const start = Math.max(0, idx - 40);
              const end = Math.min(log.content.length, idx + q.length + 60);
              matchPreview = (start > 0 ? '...' : '') + log.content.slice(start, end) + (end < log.content.length ? '...' : '');
            }
            break;
          }
        }
      }

      if (bestScore > 0) {
        scored.push({
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
          sortKey: bestScore,
        });
      }
    }

    scored.sort((a, b) => b.sortKey - a.sortKey);
    return scored.slice(0, 30);
  }, [query, jobs, jobLogs, projectMap]);

  // Server-side search for log content (debounced)
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setServerResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchJobs(query.trim());
        setServerResults(results);
      } catch {
        // Ignore errors silently
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Merge client + server results, deduplicate, enrich with server log matches
  const results = useMemo(() => {
    const seen = new Set<string>();
    const merged: SearchResult[] = [];

    // Client results first (instant, includes live log search)
    for (const r of clientResults) {
      if (!seen.has(r.jobId)) {
        seen.add(r.jobId);
        merged.push({ ...r }); // clone so we can mutate below
      }
    }

    // Server results: add new jobs not found client-side, or enrich existing with log preview
    for (const r of serverResults) {
      if (!seen.has(r.jobId)) {
        seen.add(r.jobId);
        merged.push(r);
      } else {
        // Enrich existing entry with server's log match preview if client didn't find one
        if (r.matchPreview) {
          const existing = merged.find(m => m.jobId === r.jobId);
          if (existing && !existing.matchPreview) {
            existing.matchPreview = r.matchPreview;
            // If the client only matched on name/prompt but server found a log match, note it
            if (existing.matchField !== 'log' && r.matchField === 'log') {
              existing.matchPreview = r.matchPreview;
            }
          }
        }
      }
    }

    return merged;
  }, [clientResults, serverResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, query]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll('.cmd-palette-item');
    const item = items[selectedIndex] as HTMLElement | undefined;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((result: SearchResult) => {
    onSelectJob(result.projectId, result.jobId);
    onClose();
  }, [onSelectJob, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) handleSelect(results[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [results, selectedIndex, handleSelect, onClose]);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running': return <span className="cmd-palette-status-dot running" />;
      case 'idle': return <span className="cmd-palette-status-dot idle" />;
      case 'completed': return <span className="cmd-palette-status-dot completed" />;
      case 'failed': return <span className="cmd-palette-status-dot failed" />;
      case 'queued': return <span className="cmd-palette-status-dot queued" />;
      default: return null;
    }
  };

  const matchIcon = (field: string) => {
    switch (field) {
      case 'name': return <Hash size={10} style={{ color: 'var(--accent)', flexShrink: 0 }} />;
      case 'log': return <MessageSquare size={10} style={{ color: 'var(--info)', flexShrink: 0 }} />;
      default: return <FileText size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />;
    }
  };

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Search input */}
        <div className="cmd-palette-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cmd-palette-input"
            type="text"
            placeholder="Search jobs, prompts, chat history..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          {isSearching && <span className="cmd-palette-spinner" />}
          {query && (
            <button
              className="cmd-palette-clear"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="cmd-palette-results" ref={listRef}>
          {results.length === 0 && query.trim() ? (
            <div className="cmd-palette-empty">
              {isSearching ? 'Searching...' : 'No matching jobs found'}
            </div>
          ) : results.length === 0 ? (
            <div className="cmd-palette-empty">
              Start typing to search across all jobs and chat history
            </div>
          ) : (
            <>
              {!query.trim() && (
                <div className="cmd-palette-section-label">Recent Jobs</div>
              )}
              {query.trim() && serverResults.some(r => r.matchField === 'log') && (
                <div className="cmd-palette-section-label">
                  <MessageSquare size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  Includes chat history matches
                </div>
              )}
              {results.map((result, index) => {
                const project = projectMap.get(result.projectId);
                const displayName = result.jobName || result.prompt;
                const truncatedPrompt = result.prompt.length > 80
                  ? result.prompt.slice(0, 80) + '...'
                  : result.prompt;

                return (
                  <div
                    key={result.jobId}
                    className={`cmd-palette-item ${index === selectedIndex ? 'selected' : ''}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="cmd-palette-item-main">
                      <div className="cmd-palette-item-top">
                        {statusIcon(result.status)}
                        <span className="cmd-palette-item-name">
                          {query.trim()
                            ? highlightMatch(
                                result.jobName || result.prompt.slice(0, 60),
                                query.trim()
                              )
                            : (result.jobName || result.prompt.slice(0, 60))}
                        </span>
                        {result.mode === 'session' && (
                          <span className="cmd-palette-session-badge">session</span>
                        )}
                      </div>
                      {result.jobName && (
                        <div className="cmd-palette-item-prompt">
                          {query.trim()
                            ? highlightMatch(truncatedPrompt, query.trim())
                            : truncatedPrompt}
                        </div>
                      )}
                      {result.matchPreview && (
                        <div className="cmd-palette-item-log-match">
                          <MessageSquare size={9} />
                          <span>
                            {highlightMatch(result.matchPreview, query.trim())}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="cmd-palette-item-meta">
                      {project && (
                        <span className="cmd-palette-project-badge">{project.name}</span>
                      )}
                      <span className="cmd-palette-item-time">{timeAgo(result.updatedAt)}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="cmd-palette-hint">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
          <span><kbd>&crarr;</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
          {results.length > 0 && (
            <span style={{ marginLeft: 'auto' }}>{results.length} result{results.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}
