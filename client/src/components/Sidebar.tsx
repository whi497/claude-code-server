import { useState, useRef, useEffect } from 'react';
import { FolderOpen, Plus, MessageCircleQuestion, ClipboardCheck, Search, Download, Archive, ArchiveRestore, MoreHorizontal, ChevronDown, ChevronRight, Check, X, Square, Sun, Moon } from 'lucide-react';
import type { Project, Job, ApprovalRequest } from '../types';
import { api } from '../hooks/api';

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
  onImport?: () => void;
  onArchiveProject?: (id: string) => void;
  onUnarchiveProject?: (id: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  style?: React.CSSProperties;
}

const typeIcons: Record<string, typeof MessageCircleQuestion> = {
  question: MessageCircleQuestion,
  plan_exit: ClipboardCheck,
};

export function Sidebar({
  projects, jobs, approvals, pendingApprovals,
  selectedProjectId, selectedJobId, selectedApprovalId, isApprovalView,
  connected, onSelectProject, onSelectJob, onSelectApproval, onSelectApprovalView,
  onNewProject, onOpenSearch, onImport, onArchiveProject, onUnarchiveProject, theme, onToggleTheme, style,
}: Props) {
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [renamingJobId, setRenamingJobId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingJobId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingJobId]);

  const startRename = (j: Job) => {
    setRenamingJobId(j.id);
    setRenameValue(j.name || j.prompt.slice(0, 40));
  };

  const commitRename = (jobId: string) => {
    if (renameValue.trim()) {
      api.renameJob(jobId, renameValue.trim()).catch(console.error);
    }
    setRenamingJobId(null);
  };

  const cancelRename = () => setRenamingJobId(null);

  const activeProjects = projects.filter(p => !p.archived);
  const archivedProjects = projects.filter(p => p.archived);

  const jobCountFor = (pid: string) => jobs.filter(j => j.projectId === pid && j.status !== 'archived').length;
  const runningFor = (pid: string) => jobs.filter(j => j.projectId === pid && (j.status === 'running' || j.status === 'idle')).length;
  const activeJobsFor = (pid: string) => jobs.filter(j => j.projectId === pid && (j.status === 'running' || j.status === 'idle'));
  const hasApprovals = approvals.length > 0;

  const handleContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    setContextMenu({ id: projectId, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="sidebar" style={style} onClick={() => setContextMenu(null)}>
      <div className="sidebar-header">
        <div className={`dot ${connected ? '' : 'offline'}`} />
        <h1>CLAUDE CODE SERVER</h1>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
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
          <div className="flex items-center gap-1">
            {onImport && (
              <button className="btn-icon" onClick={onImport} title="Import from local Claude sessions">
                <Download size={14} />
              </button>
            )}
            <button className="btn-icon" onClick={onNewProject} title="New project">
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="project-list">
        {activeProjects.map(p => {
          const activeJobs = activeJobsFor(p.id);
          return (
            <div key={p.id}>
              <div
                className={`project-item ${!isApprovalView && selectedProjectId === p.id ? 'active' : ''}`}
                onClick={() => onSelectProject(p.id)}
                onContextMenu={(e) => handleContextMenu(e, p.id)}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={14} />
                  <span>{p.name}</span>
                  {p.importedFrom === 'local' && (
                    <span className="badge badge-imported" style={{ fontSize: 8, padding: '1px 4px' }}>imported</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {runningFor(p.id) > 0 && (
                    <span className="badge badge-running" style={{ fontSize: 9, padding: '1px 5px' }}>
                      {runningFor(p.id)}
                    </span>
                  )}
                  <span className="job-count">{jobCountFor(p.id)}</span>
                  {onArchiveProject && (
                    <button
                      className="btn-icon project-menu-btn"
                      onClick={(e) => { e.stopPropagation(); handleContextMenu(e, p.id); }}
                      title="More options"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  )}
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
                      {renamingJobId === j.id ? (
                        <input
                          ref={renameInputRef}
                          className="project-job-rename-input"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(j.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename(j.id);
                            if (e.key === 'Escape') cancelRename();
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="project-job-label"
                          onDoubleClick={(e) => { e.stopPropagation(); startRename(j); }}
                        >
                          {j.name || j.prompt.slice(0, 40)}
                        </span>
                      )}
                      <div className="project-job-actions" onClick={e => e.stopPropagation()}>
                        {j.status === 'idle' && j.mode !== 'session' && (
                          <button
                            className="btn-icon project-job-action-btn project-job-action-success"
                            title="Complete Now"
                            onClick={() => api.completeNow(j.id).catch(console.error)}
                          >
                            <Check size={10} />
                          </button>
                        )}
                        {j.status === 'idle' && j.mode === 'session' && (
                          <button
                            className="btn-icon project-job-action-btn"
                            title="Close Session"
                            onClick={() => api.closeSession(j.id).catch(console.error)}
                          >
                            <X size={10} />
                          </button>
                        )}
                        <button
                          className="btn-icon project-job-action-btn project-job-action-danger"
                          title="Stop"
                          onClick={() => api.stopJob(j.id).catch(console.error)}
                        >
                          <Square size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {activeProjects.length === 0 && (
          <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            No projects yet
          </div>
        )}
      </div>

      {/* Archived projects section */}
      {archivedProjects.length > 0 && (
        <>
          <div className="sidebar-divider" />
          <div
            className="sidebar-archived-toggle"
            onClick={() => setShowArchivedProjects(!showArchivedProjects)}
          >
            {showArchivedProjects ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Archive size={12} />
            <span>Archived Projects</span>
            <span className="archived-count">{archivedProjects.length}</span>
          </div>
          {showArchivedProjects && (
            <div className="project-list archived-project-list">
              {archivedProjects.map(p => (
                <div
                  key={p.id}
                  className={`project-item archived-project-card ${!isApprovalView && selectedProjectId === p.id ? 'active' : ''}`}
                  onClick={() => onSelectProject(p.id)}
                >
                  <div className="flex items-center gap-2">
                    <FolderOpen size={14} />
                    <span>{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="job-count">{jobCountFor(p.id)}</span>
                    {onUnarchiveProject && (
                      <button
                        className="btn-icon archived-restore-btn"
                        onClick={(e) => { e.stopPropagation(); onUnarchiveProject(p.id); }}
                        title="Restore project"
                      >
                        <ArchiveRestore size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Context menu */}
      {contextMenu && onArchiveProject && (
        <div
          className="context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => { onArchiveProject(contextMenu.id); setContextMenu(null); }}
          >
            <Archive size={12} />
            Archive Project
          </button>
        </div>
      )}
    </div>
  );
}
