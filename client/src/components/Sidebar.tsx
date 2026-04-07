import { FolderOpen, Plus } from 'lucide-react';
import type { Project, Job } from '../types';

interface Props {
  projects: Project[];
  jobs: Job[];
  selectedProjectId: string | null;
  connected: boolean;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
}

export function Sidebar({ projects, jobs, selectedProjectId, connected, onSelectProject, onNewProject }: Props) {
  const jobCountFor = (pid: string) => jobs.filter(j => j.projectId === pid && j.status !== 'archived').length;
  const runningFor = (pid: string) => jobs.filter(j => j.projectId === pid && j.status === 'running').length;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className={`dot ${connected ? '' : 'offline'}`} />
        <h1>CLAUDE CODE SERVER</h1>
      </div>

      <div className="sidebar-section">
        <div className="flex items-center justify-between mb-2">
          <span className="sidebar-section-title" style={{ margin: 0 }}>Projects</span>
          <button className="btn-icon" onClick={onNewProject} title="New project">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="project-list">
        {projects.map(p => (
          <div
            key={p.id}
            className={`project-item ${selectedProjectId === p.id ? 'active' : ''}`}
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
        ))}
        {projects.length === 0 && (
          <div style={{ padding: '20px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            No projects yet
          </div>
        )}
      </div>
    </div>
  );
}
