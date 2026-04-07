import type { Job } from '../types';
import { Clock, DollarSign } from 'lucide-react';

interface Props {
  jobs: Job[];
  selectedJobId: string | null;
  onSelect: (id: string) => void;
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function JobList({ jobs, selectedJobId, onSelect }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '40px 16px' }}>
        <p>No jobs yet. Submit a prompt to get started.</p>
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', flex: 1, padding: '12px' }}>
      {jobs.map(j => (
        <div
          key={j.id}
          className={`job-card ${selectedJobId === j.id ? 'active' : ''}`}
          onClick={() => onSelect(j.id)}
        >
          <div className="job-card-header">
            <span className={`badge badge-${j.status}`}>
              {j.status === 'running' ? <span className="running-indicator">{j.status}</span> : j.status}
            </span>
          </div>
          <div className="prompt">{j.prompt}</div>
          <div className="meta">
            <span className="flex items-center gap-2">
              <Clock size={10} /> {timeAgo(j.createdAt)}
            </span>
            {j.costUsd != null && (
              <span className="flex items-center gap-2">
                <DollarSign size={10} /> ${j.costUsd.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
