import type { ApprovalRequest, Project, Job } from '../types';
import { renderMarkdown } from './Markdown';
import { MessageCircleQuestion, ClipboardCheck, Clock } from 'lucide-react';

interface Props {
  approvals: ApprovalRequest[];
  projects: Project[];
  jobs: Job[];
  selectedApprovalId: string | null;
  onSelect: (id: string) => void;
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const typeIcons: Record<string, typeof MessageCircleQuestion> = {
  question: MessageCircleQuestion,
  plan_exit: ClipboardCheck,
};

const typeLabels: Record<string, string> = {
  question: 'Question',
  plan_exit: 'Approve Plan',
};

const statusLabels: Record<string, string> = {
  pending: 'pending',
  answered: 'answered',
  approved: 'approved',
  rejected: 'rejected',
  expired: 'expired',
};

export function ApprovalList({ approvals, projects, jobs, selectedApprovalId, onSelect }: Props) {
  // Sort: pending first (newest first), then resolved (newest first)
  const sorted = [...approvals].sort((a, b) => {
    const aPending = a.status === 'pending' ? 0 : 1;
    const bPending = b.status === 'pending' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const pending = sorted.filter(a => a.status === 'pending');
  const resolved = sorted.filter(a => a.status !== 'pending');

  if (approvals.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '40px 16px' }}>
        <p>No approvals yet. Claude will request approval when needed.</p>
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', flex: 1, padding: '8px' }}>
      {pending.length > 0 && (
        <div className="approval-list-section-label">Pending ({pending.length})</div>
      )}
      {pending.map(a => {
        const Icon = typeIcons[a.type] ?? MessageCircleQuestion;
        const project = projects.find(p => p.id === a.projectId);
        const job = jobs.find(j => j.id === a.jobId);
        const isPlan = a.type === 'plan_exit';
        return (
          <div
            key={a.id}
            className={`approval-list-item ${selectedApprovalId === a.id ? 'active' : ''} pending`}
            onClick={() => onSelect(a.id)}
          >
            <div className="approval-list-item-header">
              <Icon size={14} className="approval-type-icon" />
              <span className="approval-list-type">{typeLabels[a.type]}</span>
              <span className={`badge badge-${a.status}`} style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }}>
                {statusLabels[a.status]}
              </span>
            </div>
            {isPlan ? (
              <div className="approval-list-plan-preview">
                {renderMarkdown(a.content)}
              </div>
            ) : (
              <div className="approval-list-content">{a.content}</div>
            )}
            <div className="approval-list-meta">
              <span>{project?.name ?? 'Unknown'}</span>
              <span className="approval-list-sep">/</span>
              <span>{job?.name || job?.prompt?.slice(0, 30) || 'Unknown job'}</span>
              <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                <Clock size={9} /> {timeAgo(a.createdAt)}
              </span>
            </div>
          </div>
        );
      })}
      {resolved.length > 0 && (
        <div className="approval-list-section-label" style={{ marginTop: pending.length > 0 ? 12 : 0 }}>
          Resolved ({resolved.length})
        </div>
      )}
      {resolved.map(a => {
        const Icon = typeIcons[a.type] ?? MessageCircleQuestion;
        const project = projects.find(p => p.id === a.projectId);
        const job = jobs.find(j => j.id === a.jobId);
        const isPlan = a.type === 'plan_exit';
        return (
          <div
            key={a.id}
            className={`approval-list-item ${selectedApprovalId === a.id ? 'active' : ''} ${a.status}`}
            onClick={() => onSelect(a.id)}
          >
            <div className="approval-list-item-header">
              <Icon size={14} className="approval-type-icon" />
              <span className="approval-list-type">{typeLabels[a.type]}</span>
              <span className={`badge badge-${a.status}`} style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }}>
                {statusLabels[a.status]}
              </span>
            </div>
            {isPlan && !a.response ? (
              <div className="approval-list-plan-preview resolved">
                {renderMarkdown(a.content)}
              </div>
            ) : (
              <div className="approval-list-content">{a.response ? `${a.response}` : a.content}</div>
            )}
            <div className="approval-list-meta">
              <span>{project?.name ?? 'Unknown'}</span>
              <span className="approval-list-sep">/</span>
              <span>{job?.name || job?.prompt?.slice(0, 30) || 'Unknown job'}</span>
              <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                <Clock size={9} /> {timeAgo(a.createdAt)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
