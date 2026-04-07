import { useState } from 'react';
import { useStore } from './hooks/useStore';
import { Sidebar } from './components/Sidebar';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';
import { NewJobModal } from './components/NewJobModal';
import { NewProjectModal } from './components/NewProjectModal';
import { Terminal as TerminalIcon, Plus } from 'lucide-react';

export default function App() {
  const store = useStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  const selectedProject = store.projects.find(p => p.id === selectedProjectId);
  const projectJobs = store.jobs
    .filter(j => j.projectId === selectedProjectId && j.status !== 'archived')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const selectedJob = store.jobs.find(j => j.id === selectedJobId);
  const selectedJobLogs = selectedJobId ? (store.jobLogs[selectedJobId] ?? []) : [];

  return (
    <div className="app">
      <Sidebar
        projects={store.projects}
        jobs={store.jobs}
        selectedProjectId={selectedProjectId}
        connected={store.connected}
        onSelectProject={(id) => { setSelectedProjectId(id); setSelectedJobId(null); }}
        onNewProject={() => setShowNewProject(true)}
      />

      <div className="main">
        {selectedProject ? (
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
