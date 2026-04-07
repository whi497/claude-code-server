import { FolderOpen, Plus, MessageCircleQuestion, ClipboardCheck, Search } from 'lucide-react';
import type { Project, Job, ApprovalRequest } from '../types';

interface Props {
  projects: Project[];
  jobs: Job[];
  approvals: ApprovalRequest[];
  pendingApprovals: ApprovalRequest[];
  selectedProjectId: string | null;
  selectedJobId: string | null;
  selectedApprovalId: string | null;
  isApprovalView: boolean;
  connected: boolean;
  onSelectProject: (id: string) => void;
  onSelectJob: (projectId: string, jobId: string) => void;
  onSelectApproval: (id: string) => void;
  onSelectApprovalView: () => void;
  onNewProject: () => void;
  onOpenSearch?: () => void;
  style?: React.CSSProperties;
}

const typeIcons: Record<string, typeof MessageCircleQuestion> = {
  question: MessageCircleQuestion,
  plan_exit: ClipboardCheck,
};

export function Sidebar({
  projects, jobs, approvals, pendingApprovals,
  selectedProjectId, selectedJobId, selectedApprovalId, isApprovalView,
  connected, onSelectProject, onSelectJob, onSelectApproval, onSelectApprovalView, onNewProject, onOpenSearch, style,
}: Props) {
  const jobCountFor = (pid: string) => jobs.filter(j => j.projectId === pid && j.status !== 'archived').length;
  const runningFor = (pid: string) => jobs.filter(j => j.projectId === pid && (j.status === 'running' || j.status === 'idle')).length;
  const activeJobsFor = (pid: string) => jobs.filter(j => j.projectId === pid && (j.status === 'running' || j.status === 'idle'));
  const hasApprovals = approvals.length > 0;

  return (
    <div className="sidebar" style={style}>
      <div className="sidebar-header">
        <div className={`dot ${connected ? '' : 'offline'}`} />
        <h1>CLAUDE CODE SERVER</h1>
        {onOpenSearch && (
          <button
            className="cmd-palette-trigger"
            onClick={onOpenSearch}
            title="Search jobs (Cmd+K)"
          >
            <Search size={12} />
            <kbd>K</kbd>
          </button>
        )}
      </div>

      {/* Approvals section */}
      {hasApprovals && (
        <>
          <div className="sidebar-section">
            <div className="flex items-center justify-between mb-2">
              <span
                className={`sidebar-section-title sidebar-section-clickable ${isApprovalView && !selectedApprovalId ? 'active' : ''}`}
                style={{ margin: 0, cursor: 'pointer' }}
                onClick={onSelectApprovalView}
              >
                <ClipboardCheck size={14} style={{ marginRight: 4 }} />
                Approvals
                {pendingApprovals.length > 0 && (
                  <span className="approval-count-badge">{pendingApprovals.length}</span>
                )}
              </span>
            </div>
          </div>
          <div className="sidebar-approval-list">
            {pendingApprovals.map(a => {
              const Icon = typeIcons[a.type] ?? MessageCircleQuestion;
              return (
                <div
                  key={a.id}
                  className={`sidebar-approval-item ${isApprovalView && selectedApprovalId === a.id ? 'active' : ''}`}
                  onClick={() => onSelectApproval(a.id)}
                >
                  <span className="badge badge-pending" style={{ fontSize: 8, padding: '1px 5px', flexShrink: 0 }}>
                    <span className="running-indicator" style={{ fontSize: 8 }}>new</span>
                  </span>
                  <Icon size={12} style={{ flexShrink: 0, color: 'var(--warning, #f59e0b)' }} />
                  <span className="sidebar-approval-label">{a.content.slice(0, 40)}</span>
                </div>
              );
            })}
          </div>
          <div className="sidebar-divider" />
        </>
      )}

      {/* Projects section */}
      <div className="sidebar-section">
        <div className="flex items-center justify-between mb-2">
          <span className="sidebar-section-title" style={{ margin: 0 }}>Projects</span>
          <button className="btn-icon" onClick={onNewProject} title="New project">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="project-list">
        {projects.map(p => {
          const activeJobs = activeJobsFor(p.id);
          return (
            <div key={p.id}>
              <div
                className={`project-item ${!isApprovalView && selectedProjectId === p.id ? 'active' : ''}`}
                onClick={() => onSelectProject(p.id)}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} />
                  <span>{p.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {runningFor(p.id) > 0 && (
                    <span className="badge badge-running" style={{ fontSize: 9, padding: '1px 5px' }}>
                      {runningFor(p.id)}
                    </span>
                  )}
                  <span className="job-count">{jobCountFor(p.id)}</span>
                </div>
              </div>
              {activeJobs.length > 0 && (
                <div className="project-active-jobs">
                  {activeJobs.map(j => (
                    <div
                      key={j.id}
                      className={`project-job-item ${!isApprovalView && selectedJobId === j.id ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onSelectJob(p.id, j.id); }}
                    >
                      <span className={`badge badge-${j.status}`} style={{ fontSize: 8, padding: '1px 5px', flexShrink: 0 }}>
                        {j.status === 'running'
                          ? <span className="running-indicator" style={{ fontSize: 8 }}>run</span>
                          : <span className="running-indicator" style={{ fontSize: 8 }}>idle</span>}
                      </span>
                      <span className="project-job-label">
                        {j.name || j.prompt.slice(0, 40)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {projects.length === 0 && (
          <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            No projects yet
          </div>
        )}
      </div>
    </div>
  );
}
