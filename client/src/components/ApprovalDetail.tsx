import { useState } from 'react';
import type { ApprovalRequest, Project, Job } from '../types';
import { api } from '../hooks/api';
import { renderMarkdown } from './Markdown';
import { MessageCircleQuestion, ClipboardCheck, Check, X, Send, ExternalLink } from 'lucide-react';

interface Props {
  approval: ApprovalRequest;
  projects: Project[];
  jobs: Job[];
  onNavigateToJob?: (projectId: string, jobId: string) => void;
}

const typeIcons: Record<string, typeof MessageCircleQuestion> = {
  question: MessageCircleQuestion,
  plan_exit: ClipboardCheck,
};

const typeLabels: Record<string, string> = {
  question: 'Question',
  plan_exit: 'Approve Plan',
};

const statusColors: Record<string, string> = {
  pending: 'var(--warning, #f59e0b)',
  answered: 'var(--accent)',
  approved: 'var(--accent)',
  rejected: 'var(--danger, #ef4444)',
  expired: 'var(--text-muted)',
};

export function ApprovalDetail({ approval, projects, jobs, onNavigateToJob }: Props) {
  const [answerText, setAnswerText] = useState('');
  const [rejectText, setRejectText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find(p => p.id === approval.projectId);
  const job = jobs.find(j => j.id === approval.jobId);
  const isPending = approval.status === 'pending';
  const isPlan = approval.type === 'plan_exit';
  const Icon = typeIcons[approval.type] ?? MessageCircleQuestion;

  async function handleAnswer() {
    if (!answerText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.respondToApproval(approval.id, { action: 'answer', text: answerText.trim() });
      setAnswerText('');
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  async function handleOptionSelect(label: string) {
    setSubmitting(true);
    setError(null);
    try {
      await api.respondToApproval(approval.id, { action: 'answer', text: label });
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    try {
      await api.respondToApproval(approval.id, { action: 'approve' });
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  async function handleReject() {
    setSubmitting(true);
    setError(null);
    try {
      await api.respondToApproval(approval.id, { action: 'reject', text: rejectText.trim() || undefined });
      setRejectText('');
      setShowRejectInput(false);
    } catch (err: any) {
      setError(err.message);
    }
    setSubmitting(false);
  }

  return (
    <div className="approval-detail">
      {/* Header */}
      <div className="approval-detail-header">
        <div className="approval-detail-title-row">
          <Icon size={20} style={{ color: statusColors[approval.status] }} />
          <h3 className="approval-detail-title">{typeLabels[approval.type] ?? approval.type}</h3>
          <span
            className={`badge badge-${approval.status}`}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            {approval.status}
          </span>
        </div>
        <div
          className="approval-detail-context"
          onClick={() => onNavigateToJob?.(approval.projectId, approval.jobId)}
          title="Click to navigate to this job"
        >
          <ExternalLink size={12} />
          <span>{project?.name ?? 'Unknown project'}</span>
          <span className="approval-list-sep">/</span>
          <span>{job?.name || job?.prompt?.slice(0, 50) || 'Unknown job'}</span>
        </div>
        <div className="approval-detail-time">
          Created: {new Date(approval.createdAt).toLocaleString()}
          {approval.respondedAt && (
            <> &middot; Responded: {new Date(approval.respondedAt).toLocaleString()}</>
          )}
        </div>
      </div>

      {/* Content — render as markdown for plans, plain text for questions */}
      <div className="approval-detail-content-area">
        <div className="approval-detail-label">
          {isPlan ? "Claude's Plan" : "Claude's Question"}
        </div>
        {isPlan ? (
          <div className="approval-detail-content approval-plan-content">
            {renderMarkdown(approval.content)}
          </div>
        ) : (
          <div className="approval-detail-content">{approval.content}</div>
        )}
      </div>

      {/* Options (for AskUserQuestion with predefined choices) */}
      {isPending && approval.options && approval.options.length > 0 && (
        <div className="approval-detail-options">
          <div className="approval-detail-label">Options</div>
          <div className="approval-options-grid">
            {approval.options.map((opt, i) => (
              <button
                key={i}
                className="approval-option-btn"
                disabled={submitting}
                onClick={() => handleOptionSelect(opt.label)}
              >
                <span className="approval-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="approval-option-desc">{opt.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action area */}
      {isPending && (
        <div className="approval-detail-actions">
          {approval.type === 'question' ? (
            <>
              <div className="approval-detail-label">Your Answer</div>
              <div className="approval-answer-row">
                <input
                  className="approval-input"
                  type="text"
                  placeholder="Type your answer..."
                  value={answerText}
                  onChange={e => setAnswerText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleAnswer(); }}
                  disabled={submitting}
                />
                <button
                  className="approval-btn approval-btn-send"
                  onClick={handleAnswer}
                  disabled={submitting || !answerText.trim()}
                >
                  <Send size={14} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="approval-detail-label">Decision</div>
              <div className="approval-plan-actions">
                <button
                  className="approval-btn approval-btn-approve"
                  onClick={handleApprove}
                  disabled={submitting}
                >
                  <Check size={14} /> Approve
                </button>
                {!showRejectInput ? (
                  <button
                    className="approval-btn approval-btn-reject"
                    onClick={() => setShowRejectInput(true)}
                    disabled={submitting}
                  >
                    <X size={14} /> Reject
                  </button>
                ) : (
                  <div className="approval-reject-row">
                    <input
                      className="approval-input"
                      type="text"
                      placeholder="Reason (optional)..."
                      value={rejectText}
                      onChange={e => setRejectText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleReject(); if (e.key === 'Escape') setShowRejectInput(false); }}
                      disabled={submitting}
                      autoFocus
                    />
                    <button
                      className="approval-btn approval-btn-reject"
                      onClick={handleReject}
                      disabled={submitting}
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Resolved response */}
      {!isPending && approval.response && (
        <div className="approval-detail-response">
          <div className="approval-detail-label">Response</div>
          <div className="approval-detail-response-text">{approval.response}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="approval-detail-error">{error}</div>
      )}
    </div>
  );
}
