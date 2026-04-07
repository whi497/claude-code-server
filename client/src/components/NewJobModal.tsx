import { useState } from 'react';
import { api } from '../hooks/api';
import type { Job } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: (j: Job) => void;
}

export function NewJobModal({ projectId, onClose, onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const job = await api.createJob(projectId, prompt.trim());
      onCreated(job);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New Job</h3>
        <p className="text-sm text-muted mb-4">
          Submit a prompt for Claude Code to execute in the project directory.
        </p>
        <textarea
          className="textarea"
          placeholder="e.g. Create a Next.js app with authentication and a dashboard page..."
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={5}
          autoFocus
        />
        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !prompt.trim()}>
            {loading ? 'Submitting...' : 'Submit Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
