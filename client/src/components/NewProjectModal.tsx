import { useState } from 'react';
import { api } from '../hooks/api';
import type { Project } from '../types';

interface Props {
  onClose: () => void;
  onCreated: (p: Project) => void;
}

export function NewProjectModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [useCustomPath, setUseCustomPath] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const project = await api.createProject(
        name.trim(),
        useCustomPath && customPath.trim() ? customPath.trim() : undefined,
      );
      onCreated(project);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New Project</h3>
        <p className="text-sm text-muted mb-4">
          Creates a working directory for Claude Code to work in.
        </p>
        <input
          className="input"
          placeholder="Project name (e.g. my-web-app)"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !useCustomPath && handleCreate()}
          autoFocus
        />
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={useCustomPath}
            onChange={e => setUseCustomPath(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Use custom path
        </label>
        {useCustomPath && (
          <input
            className="input"
            placeholder="Absolute path (e.g. /Users/me/projects/my-app)"
            value={customPath}
            onChange={e => setCustomPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            style={{ marginTop: 8 }}
          />
        )}
        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
