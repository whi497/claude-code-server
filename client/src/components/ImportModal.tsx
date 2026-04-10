import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Search, RefreshCw, Download, Check, FolderOpen, ChevronDown, ChevronRight, Loader } from 'lucide-react';
import { api } from '../hooks/api';
import type { LocalProject, LocalSession, ImportProgress, ImportResult } from '../types';

interface Props {
  importProgress: ImportProgress | null;
  importResult: ImportResult | null;
  onClose: () => void;
}

export function ImportModal({ importProgress, importResult, onClose }: Props) {
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedSessions, setSelectedSessions] = useState<Map<string, Set<string>>>(new Map());
  const [importing, setImporting] = useState(false);
  const [showResult, setShowResult] = useState<ImportResult | null>(null);

  const discover = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.discoverLocalProjects(undefined, refresh);
      setLocalProjects(data);
      // Auto-expand first 5 projects
      const autoExpand = new Set<string>(data.slice(0, 5).map((p: LocalProject) => p.dirName));
      setExpandedDirs(autoExpand);
    } catch (err: any) {
      setError(err.message || 'Failed to discover local projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { discover(); }, [discover]);

  // Watch for import completion via WS
  useEffect(() => {
    if (importResult) {
      setShowResult(importResult);
      setImporting(false);
      setSelectedSessions(new Map()); // Clear selections after import
      // Re-discover to refresh "already imported" badges
      discover(true);
    }
  }, [importResult, discover]);

  // Fuzzy filter
  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return localProjects;
    const q = searchQuery.toLowerCase();
    return localProjects
      .map(p => {
        const projectMatch =
          p.realPath.toLowerCase().includes(q) ||
          p.projectName.toLowerCase().includes(q);
        const filteredSessions = p.sessions.filter(
          s =>
            (s.slug && s.slug.toLowerCase().includes(q)) ||
            (s.firstPrompt && s.firstPrompt.toLowerCase().includes(q)) ||
            s.sessionId.toLowerCase().includes(q),
        );
        if (projectMatch || filteredSessions.length > 0) {
          return {
            ...p,
            sessions: projectMatch ? p.sessions : filteredSessions,
          };
        }
        return null;
      })
      .filter(Boolean) as LocalProject[];
  }, [localProjects, searchQuery]);

  const toggleDir = (dirName: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirName)) next.delete(dirName);
      else next.add(dirName);
      return next;
    });
  };

  const toggleSession = (dirName: string, fileName: string) => {
    setSelectedSessions(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(dirName) ?? []);
      if (set.has(fileName)) set.delete(fileName);
      else set.add(fileName);
      if (set.size === 0) next.delete(dirName);
      else next.set(dirName, set);
      return next;
    });
  };

  const toggleAllSessions = (dirName: string, sessions: LocalSession[]) => {
    setSelectedSessions(prev => {
      const next = new Map(prev);
      const importable = sessions.filter(s => !s.alreadyImported);
      const current = next.get(dirName) ?? new Set();
      const allSelected = importable.every(s => current.has(s.fileName));

      if (allSelected) {
        next.delete(dirName);
      } else {
        next.set(dirName, new Set(importable.map(s => s.fileName)));
      }
      return next;
    });
  };

  const totalSelected = useMemo(() => {
    let count = 0;
    for (const set of selectedSessions.values()) count += set.size;
    return count;
  }, [selectedSessions]);

  const handleImport = async () => {
    if (totalSelected === 0) return;
    setImporting(true);
    setShowResult(null);
    try {
      const selections = Array.from(selectedSessions.entries()).map(([dirName, sessions]) => ({
        dirName,
        sessions: Array.from(sessions),
      }));
      await api.importProjects(selections);
      // Result will come via WS import:complete event
    } catch (err: any) {
      setError(err.message || 'Import failed');
      setImporting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal import-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <Download size={16} />
            <h2>Import Local Claude Sessions</h2>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Search bar */}
        <div className="import-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search projects, sessions, prompts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <button className="btn btn-sm" onClick={() => discover(true)} title="Refresh">
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {/* Content */}
        <div className="import-content">
          {loading && localProjects.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px' }}>
              <Loader size={24} className="spin" />
              <p>Discovering local Claude projects...</p>
            </div>
          ) : error ? (
            <div className="empty-state" style={{ padding: '40px' }}>
              <p style={{ color: 'var(--danger)' }}>{error}</p>
              <button className="btn btn-sm" onClick={() => discover(true)}>Retry</button>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px' }}>
              <FolderOpen size={32} style={{ opacity: 0.3 }} />
              <p>{searchQuery ? 'No matching projects found' : 'No local Claude projects found in ~/.claude/projects/'}</p>
            </div>
          ) : (
            filteredProjects.map(project => {
              const isExpanded = expandedDirs.has(project.dirName);
              const projectSels = selectedSessions.get(project.dirName) ?? new Set();
              const importableSessions = project.sessions.filter(s => !s.alreadyImported);
              const allSelected = importableSessions.length > 0 && importableSessions.every(s => projectSels.has(s.fileName));
              const someSelected = importableSessions.some(s => projectSels.has(s.fileName));

              return (
                <div key={project.dirName} className="import-project-group">
                  <div className="import-project-header" onClick={() => toggleDir(project.dirName)}>
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <FolderOpen size={14} />
                      <span className="import-project-name">{project.projectName}</span>
                      <span className="text-sm text-muted">({project.sessions.length} sessions)</span>
                      {project.existingProjectId && (
                        <span className="badge badge-info" style={{ fontSize: 9, padding: '1px 5px' }}>In App</span>
                      )}
                    </div>
                    <span className="text-sm text-muted font-mono" style={{ fontSize: 10 }}>{project.realPath}</span>
                  </div>

                  {isExpanded && (
                    <div className="import-sessions-list">
                      {/* Select all toggle */}
                      {importableSessions.length > 0 && (
                        <label
                          className="import-session-item import-select-all"
                          onClick={(e) => { e.preventDefault(); toggleAllSessions(project.dirName, project.sessions); }}
                        >
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                            readOnly
                          />
                          <span className="text-sm">Select all importable ({importableSessions.length})</span>
                        </label>
                      )}

                      {project.sessions.map(session => {
                        const isSelected = projectSels.has(session.fileName);
                        const isDisabled = session.alreadyImported;

                        return (
                          <label
                            key={session.fileName}
                            className={`import-session-item ${isDisabled ? 'imported' : ''} ${isSelected ? 'selected' : ''}`}
                            onClick={(e) => {
                              if (isDisabled) return;
                              e.preventDefault();
                              toggleSession(project.dirName, session.fileName);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={isDisabled}
                              readOnly
                            />
                            <div className="import-session-info">
                              <div className="import-session-name">
                                {session.slug || session.sessionId.slice(0, 8)}
                                {isDisabled && (
                                  <span className="badge badge-imported" style={{ fontSize: 8, padding: '0 4px', marginLeft: 4 }}>
                                    <Check size={8} /> imported
                                  </span>
                                )}
                              </div>
                              {session.firstPrompt && (
                                <div className="import-session-prompt">{session.firstPrompt}</div>
                              )}
                              <div className="import-session-meta">
                                <span>{session.messageCount} msgs</span>
                                {session.startedAt && <span>{formatDate(session.startedAt)}</span>}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="import-footer">
          {showResult && (
            <div className="import-result">
              <Check size={14} style={{ color: 'var(--accent)' }} />
              <span>
                {showResult.projectsCreated > 0 && `${showResult.projectsCreated} project${showResult.projectsCreated > 1 ? 's' : ''} created, `}
                {showResult.jobsCreated} job{showResult.jobsCreated !== 1 ? 's' : ''} imported
                {showResult.skipped > 0 && `, ${showResult.skipped} skipped`}
                {showResult.errors > 0 && `, ${showResult.errors} error${showResult.errors > 1 ? 's' : ''}`}
              </span>
            </div>
          )}

          {importing && importProgress && (
            <div className="import-progress">
              <div className="import-progress-bar">
                <div
                  className="import-progress-fill"
                  style={{ width: `${importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%` }}
                />
              </div>
              <span className="text-sm text-muted">
                {importProgress.current}/{importProgress.total}
                {importProgress.currentProject && ` — ${importProgress.currentProject}`}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={onClose}>
              {showResult ? 'Done' : 'Cancel'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={totalSelected === 0 || importing}
            >
              {importing ? (
                <>
                  <Loader size={12} className="spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download size={12} />
                  Import Selected ({totalSelected})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
