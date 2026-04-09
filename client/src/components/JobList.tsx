import { useState, useRef, useEffect } from 'react';
import type { Job } from '../types';
import { Clock, Archive, GitBranch } from 'lucide-react';

interface Props {
  jobs: Job[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  archivedCount?: number;
  onShowArchived?: () => void;
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function JobList({ jobs, selectedJobId, onSelect, onRename, archivedCount = 0, onShowArchived }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleDoubleClick = (j: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(j.id);
    setEditValue(j.name || j.prompt.slice(0, 80));
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const cancelRename = () => setEditingId(null);

  if (jobs.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '40px 16px' }}>
        <p>No jobs yet. Submit a prompt to get started.</p>
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', flex: 1, padding: '8px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        {jobs.map(j => (
          <div
            key={j.id}
            className={`job-card ${selectedJobId === j.id ? 'active' : ''}`}
            onClick={() => onSelect(j.id)}
          >
            <div className="job-card-header">
              <span className={`badge badge-${j.status}`} style={{ fontSize: 9, padding: '1px 5px', flexShrink: 0 }}>
                {j.status === 'running'
                  ? <span className="running-indicator" style={{ fontSize: 9 }}>run</span>
                  : j.status === 'idle'
                  ? <span className="running-indicator" style={{ fontSize: 9 }}>idle</span>
                  : j.status === 'completed' ? 'ok'
                  : j.status === 'failed' ? 'err'
                  : j.status === 'queued' ? 'que'
                  : j.status}
              </span>
              {j.mode === 'session' && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>S</span>
              )}
              {editingId === j.id ? (
                <input
                  ref={inputRef}
                  className="job-card-title-input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  className="job-card-title"
                  onDoubleClick={e => handleDoubleClick(j, e)}
                  title={j.prompt}
                >
                  {j.forkedFrom && <GitBranch size={10} className="job-fork-icon" />}
                  {j.name || j.prompt}
                </span>
              )}
              <div className="meta" style={{ marginTop: 0, flexShrink: 0 }}>
                <span className="flex items-center gap-2">
                  <Clock size={9} /> {timeAgo(j.lastInteractionAt ?? j.createdAt)}
                </span>
              </div>
            </div>
            {j.name && (
              <div className="prompt">{j.prompt}</div>
            )}
          </div>
        ))}
      </div>
      {archivedCount > 0 && onShowArchived && (
        <div className="archived-jobs-entry" onClick={onShowArchived}>
          <Archive size={14} />
          <span>Archived Jobs</span>
          <span className="archived-count">{archivedCount}</span>
        </div>
      )}
    </div>
  );
}
