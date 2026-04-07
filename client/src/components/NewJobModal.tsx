import { useState, useRef, useMemo } from 'react';
import { api } from '../hooks/api';
import { useSuggestions, type CommandDef } from '../hooks/useSuggestions';
import { SuggestionDropdown } from './SuggestionDropdown';
import type { Job } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: (j: Job) => void;
}

export function NewJobModal({ projectId, onClose, onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [sessionMode, setSessionMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const commands = useMemo<CommandDef[]>(() => [
    {
      id: 'session',
      label: '/session',
      description: 'Toggle persistent session mode',
      available: () => true,
      execute: () => setSessionMode(prev => !prev),
    },
  ], []);

  const suggestions = useSuggestions({
    inputRef: textareaRef,
    value: prompt,
    setValue: setPrompt,
    projectId,
    commands,
  });

  const handleSubmit = async () => {
    if (!prompt.trim() || suggestions.isOpen) return;
    setLoading(true);
    setError('');
    try {
      const job = await api.createJob(projectId, prompt.trim(), sessionMode ? 'session' : undefined);
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
        <div className="suggestion-wrapper">
          <textarea
            ref={textareaRef}
            className="textarea"
            placeholder="e.g. Create a Next.js app with authentication and a dashboard page..."
            value={prompt}
            onChange={suggestions.handleChange}
            onKeyDown={e => {
              suggestions.handleKeyDown(e);
              // Only submit on Ctrl/Cmd+Enter when dropdown is closed
              if (!e.defaultPrevented && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                handleSubmit();
              }
            }}
            rows={5}
            autoFocus
          />
          {suggestions.isOpen && (
            <SuggestionDropdown
              items={suggestions.items}
              selectedIndex={suggestions.selectedIndex}
              onSelect={suggestions.selectItem}
              onHover={suggestions.setSelectedIndex}
              position="below"
              loading={suggestions.loading}
              triggerType={suggestions.triggerType}
            />
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sessionMode}
            onChange={e => setSessionMode(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Start as persistent session</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            — auto-enabled when cron job detected
          </span>
        </label>
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
