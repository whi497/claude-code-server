import { useState } from 'react';
import { useStore } from './hooks/useStore';
import { api } from './hooks/api';
import { Sidebar } from './components/Sidebar';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';
import { ApprovalList } from './components/ApprovalList';
import { ApprovalDetail } from './components/ApprovalDetail';
import { NewJobModal } from './components/NewJobModal';
import { NewProjectModal } from './components/NewProjectModal';
import { Terminal as TerminalIcon, Plus, ClipboardCheck } from 'lucide-react';

export default function App() {
  const store = useStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<'project' | 'approvals'>('project');
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const selectedProject = store.projects.find(p => p.id === selectedProjectId);
  const projectJobs = store.jobs
    .filter(j => j.projectId === selectedProjectId && j.status !== 'archived')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  };

  return (
    <div className="app">
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
              <div className="split-left">
                <ApprovalList
                  approvals={store.approvals}
                  projects={store.projects}
                  jobs={store.jobs}
                  selectedApprovalId={selectedApprovalId}
                  onSelect={setSelectedApprovalId}
                />
              </div>
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
                <TerminalIcon size={16} style={{ color: 'var(--accent)' }} />
                <h2>{selectedProject.name}</h2>
                <span className="text-sm text-muted font-mono">{selectedProject.path}</span>
              </div>
              <button className="btn btn-primary" onClick={() => setShowNewJob(true)}>
                <Plus size={14} /> New Job
              </button>
            </div>
            <div className="split">
              <div className="split-left">
                <JobList
                  jobs={projectJobs}
                  selectedJobId={selectedJobId}
                  onSelect={setSelectedJobId}
                  onRename={handleRename}
                />
              </div>
              <div className="split-right">
                {selectedJob ? (
                  <JobDetail job={selectedJob} logs={selectedJobLogs} projectId={selectedProjectId!} />
                ) : (
                  <div className="empty-state">
                    <TerminalIcon size={48} />
                    <p>Select a job to view its output, or create a new one</p>
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
            <button className="btn btn-primary" onClick={() => setShowNewProject(true)}>
              <Plus size={14} /> Create Project
            </button>
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
    </div>
  );
}
