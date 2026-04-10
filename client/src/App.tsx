import { useState, useEffect } from 'react';
import { useStore } from './hooks/useStore';
import { useResizable } from './hooks/useResizable';
import { useTheme } from './hooks/useTheme';
import { api } from './hooks/api';
import { Sidebar } from './components/Sidebar';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';
import { ApprovalList } from './components/ApprovalList';
import { ApprovalDetail } from './components/ApprovalDetail';
import { NewJobModal } from './components/NewJobModal';
import { NewProjectModal } from './components/NewProjectModal';
import { ImportModal } from './components/ImportModal';
import { CommandPalette } from './components/CommandPalette';
import { Terminal as TerminalIcon, Plus, ClipboardCheck, Search, Archive, ArchiveRestore, Download } from 'lucide-react';

export default function App() {
  const store = useStore();
  const { theme, toggleTheme } = useTheme();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<'project' | 'approvals'>('project');
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Resizable panels
  const sidebarResize = useResizable({
    initialWidth: 280,
    minWidth: 200,
    maxWidth: 480,
    storageKey: 'claude-sidebar-width',
  });
  const splitLeftResize = useResizable({
    initialWidth: 340,
    minWidth: 240,
    maxWidth: 600,
    storageKey: 'claude-split-left-width',
  });

  // Cmd+K / Ctrl+K hotkey for command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const selectedProject = store.projects.find(p => p.id === selectedProjectId);
  const projectJobs = store.jobs
    .filter(j => j.projectId === selectedProjectId && j.status !== 'archived')
    .sort((a, b) => new Date(b.lastInteractionAt ?? b.createdAt).getTime() - new Date(a.lastInteractionAt ?? a.createdAt).getTime());
  const archivedJobs = store.jobs
    .filter(j => j.projectId === selectedProjectId && j.status === 'archived')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const selectedJob = store.jobs.find(j => j.id === selectedJobId);
  const selectedJobLogs = selectedJobId ? (store.jobLogs[selectedJobId] ?? []) : [];
  const selectedApproval = store.approvals.find(a => a.id === selectedApprovalId);

  const handleRename = async (jobId: string, name: string) => {
    try {
      await api.renameJob(jobId, name);
    } catch (err) {
      console.error('Failed to rename job:', err);
    }
  };

  const handleSelectProject = (id: string) => {
    setSelectedView('project');
    setSelectedProjectId(id);
    setSelectedJobId(null);
    setSelectedApprovalId(null);
    setShowArchived(false);
  };

  const handleSelectJob = (projectId: string, jobId: string) => {
    setSelectedView('project');
    setSelectedProjectId(projectId);
    setSelectedJobId(jobId);
    setSelectedApprovalId(null);
  };

  const handleSelectApproval = (id: string) => {
    setSelectedView('approvals');
    setSelectedApprovalId(id);
  };

  const handleSelectApprovalView = () => {
    setSelectedView('approvals');
    setSelectedApprovalId(null);
  };

  const handleNavigateToJob = (projectId: string, jobId: string) => {
    setSelectedView('project');
    setSelectedProjectId(projectId);
    setSelectedJobId(jobId);
    setSelectedApprovalId(null);
    setShowArchived(false);
  };

  const handleUnarchive = async (jobId: string) => {
    try {
      await api.unarchiveJob(jobId);
    } catch (err) {
      console.error('Failed to unarchive job:', err);
    }
  };

  const handleArchiveProject = async (projectId: string) => {
    try {
      await api.archiveProject(projectId);
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setSelectedJobId(null);
      }
    } catch (err) {
      console.error('Failed to archive project:', err);
    }
  };

  const handleUnarchiveProject = async (projectId: string) => {
    try {
      await api.unarchiveProject(projectId);
    } catch (err) {
      console.error('Failed to unarchive project:', err);
    }
  };

  return (
    <div className={`app${sidebarResize.isDragging || splitLeftResize.isDragging ? ' resizing' : ''}`}>
      <Sidebar
        projects={store.projects}
        jobs={store.jobs}
        approvals={store.approvals}
        pendingApprovals={store.pendingApprovals}
        selectedProjectId={selectedProjectId}
        selectedJobId={selectedJobId}
        selectedApprovalId={selectedApprovalId}
        isApprovalView={selectedView === 'approvals'}
        connected={store.connected}
        onSelectProject={handleSelectProject}
        onSelectJob={handleSelectJob}
        onSelectApproval={handleSelectApproval}
        onSelectApprovalView={handleSelectApprovalView}
        onNewProject={() => setShowNewProject(true)}
        onOpenSearch={() => setShowCommandPalette(true)}
        onImport={() => setShowImportModal(true)}
        onArchiveProject={handleArchiveProject}
        onUnarchiveProject={handleUnarchiveProject}
        theme={theme}
        onToggleTheme={toggleTheme}
        style={{ width: sidebarResize.width, minWidth: sidebarResize.width }}
      />
      <div
        className={`resize-handle resize-handle-sidebar${sidebarResize.isDragging ? ' active' : ''}`}
        onMouseDown={sidebarResize.handleMouseDown}
      />

      <div className="main">
        {selectedView === 'approvals' ? (
          /* ── Approval view ── */
          <>
            <div className="topbar">
              <div className="flex items-center gap-3">
                <ClipboardCheck size={16} style={{ color: 'var(--warning, #f59e0b)' }} />
                <h2>Approvals</h2>
                {store.pendingApprovals.length > 0 && (
                  <span className="badge badge-pending" style={{ fontSize: 11, padding: '2px 8px' }}>
                    {store.pendingApprovals.length} pending
                  </span>
                )}
              </div>
            </div>
            <div className="split">
              <div className="split-left" style={{ width: splitLeftResize.width, minWidth: splitLeftResize.width }}>
                <ApprovalList
                  approvals={store.approvals}
                  projects={store.projects}
                  jobs={store.jobs}
                  selectedApprovalId={selectedApprovalId}
                  onSelect={setSelectedApprovalId}
                />
              </div>
              <div
                className={`resize-handle resize-handle-split${splitLeftResize.isDragging ? ' active' : ''}`}
                onMouseDown={splitLeftResize.handleMouseDown}
              />
              <div className="split-right">
                {selectedApproval ? (
                  <ApprovalDetail
                    approval={selectedApproval}
                    projects={store.projects}
                    jobs={store.jobs}
                    onNavigateToJob={handleNavigateToJob}
                  />
                ) : (
                  <div className="empty-state">
                    <ClipboardCheck size={48} />
                    <p>Select an approval to view details and respond</p>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : selectedProject ? (
          /* ── Project view ── */
          <>
            <div className="topbar">
              <div className="flex items-center gap-3">
                {showArchived ? (
                  <>
                    <Archive size={16} style={{ color: 'var(--text-muted)' }} />
                    <h2>Archived Jobs</h2>
                    <span className="text-sm text-muted">({archivedJobs.length})</span>
                  </>
                ) : (
                  <>
                    <TerminalIcon size={16} style={{ color: 'var(--accent)' }} />
                    <h2>{selectedProject.name}</h2>
                    <span className="text-sm text-muted font-mono">{selectedProject.path}</span>
                    {selectedProject.archived && (
                      <span className="badge badge-archived" style={{ fontSize: 10, padding: '1px 6px' }}>archived</span>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                {showArchived && (
                  <button className="btn btn-sm" onClick={() => { setShowArchived(false); setSelectedJobId(null); }}>
                    ← Back to Jobs
                  </button>
                )}
                {!showArchived && !selectedProject.archived && (
                  <button className="btn btn-primary" onClick={() => setShowNewJob(true)}>
                    <Plus size={14} /> New Job
                  </button>
                )}
              </div>
            </div>
            <div className="split">
              <div className="split-left" style={{ width: splitLeftResize.width, minWidth: splitLeftResize.width }}>
                {showArchived ? (
                  <div className="archived-job-list" style={{ overflow: 'auto', flex: 1, padding: '8px' }}>
                    {archivedJobs.length === 0 ? (
                      <div className="empty-state" style={{ padding: '40px 16px' }}>
                        <Archive size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                        <p>No archived jobs in this project.</p>
                      </div>
                    ) : (
                      archivedJobs.map(j => (
                        <div
                          key={j.id}
                          className={`job-card archived-job-card ${selectedJobId === j.id ? 'active' : ''}`}
                          onClick={() => setSelectedJobId(j.id)}
                        >
                          <div className="job-card-header">
                            <span className="badge badge-archived" style={{ fontSize: 10, padding: '1px 6px', flexShrink: 0 }}>
                              archived
                            </span>
                            <span className="job-card-title" title={j.prompt}>
                              {j.name || j.prompt}
                            </span>
                            <button
                              className="btn btn-sm archived-restore-btn"
                              onClick={e => { e.stopPropagation(); handleUnarchive(j.id); }}
                              title="Restore from archive"
                            >
                              <ArchiveRestore size={12} />
                            </button>
                          </div>
                          {j.name && <div className="prompt">{j.prompt}</div>}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <JobList
                    jobs={projectJobs}
                    selectedJobId={selectedJobId}
                    onSelect={setSelectedJobId}
                    onRename={handleRename}
                    archivedCount={archivedJobs.length}
                    onShowArchived={() => { setShowArchived(true); setSelectedJobId(null); }}
                  />
                )}
              </div>
              <div
                className={`resize-handle resize-handle-split${splitLeftResize.isDragging ? ' active' : ''}`}
                onMouseDown={splitLeftResize.handleMouseDown}
              />
              <div className="split-right">
                {selectedJob ? (
                  <JobDetail job={selectedJob} logs={selectedJobLogs} projectId={selectedProjectId!} onNewJob={() => setShowNewJob(true)} onSelectJob={setSelectedJobId} allJobs={store.jobs} theme={theme} />
                ) : (
                  <div className="empty-state">
                    {showArchived ? (
                      <>
                        <Archive size={48} />
                        <p>Select an archived job to view, or restore it</p>
                      </>
                    ) : (
                      <>
                        <TerminalIcon size={48} />
                        <p>Select a job to view its output, or create a new one</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="empty-state" style={{ flex: 1 }}>
            <TerminalIcon size={64} />
            <h3 style={{ color: 'var(--text-secondary)' }}>Claude Code Server</h3>
            <p>Select or create a project to begin submitting jobs to Claude Code</p>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => setShowNewProject(true)}>
                <Plus size={14} /> Create Project
              </button>
              <button className="btn btn-sm" onClick={() => setShowImportModal(true)}>
                <Download size={14} /> Import Local Sessions
              </button>
            </div>
          </div>
        )}
      </div>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(p) => { setSelectedProjectId(p.id); setShowNewProject(false); }}
        />
      )}

      {showNewJob && selectedProjectId && (
        <NewJobModal
          projectId={selectedProjectId}
          onClose={() => setShowNewJob(false)}
          onCreated={(j) => { setSelectedJobId(j.id); setShowNewJob(false); }}
        />
      )}

      {showImportModal && (
        <ImportModal
          importProgress={store.importProgress}
          importResult={store.importResult}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          jobs={store.jobs}
          projects={store.projects}
          jobLogs={store.jobLogs}
          onSelectJob={(projectId, jobId) => {
            handleSelectJob(projectId, jobId);
            setShowCommandPalette(false);
          }}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
    </div>
  );
}
