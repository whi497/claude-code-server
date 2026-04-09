import { useState, useRef, useMemo } from 'react';
import { Paperclip } from 'lucide-react';
import { api } from '../hooks/api';
import { useSuggestions, type CommandDef, FALLBACK_SDK_COMMANDS } from '../hooks/useSuggestions';
import { useAttachments } from '../hooks/useAttachments';
import { SuggestionDropdown } from './SuggestionDropdown';
import { AttachmentPreview } from './AttachmentPreview';
import type { Job, ThinkingConfig, EffortLevel } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: (j: Job) => void;
}

const THINKING_BUDGET_PRESETS = [
  { label: '10k', value: 10000 },
  { label: '50k', value: 50000 },
  { label: '100k', value: 100000 },
  { label: '200k', value: 200000 },
];
const DEFAULT_THINKING_BUDGET = 10000;
const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function NewJobModal({ projectId, onClose, onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [sessionMode, setSessionMode] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState(DEFAULT_THINKING_BUDGET);
  const [thinkingEffort, setThinkingEffort] = useState<EffortLevel>('medium');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const attach = useAttachments();

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
    sdkCommands: FALLBACK_SDK_COMMANDS,
    // No onSdkCommand — commands will be inserted as text into the prompt
  });

  const handleSubmit = async () => {
    if (!prompt.trim() || suggestions.isOpen) return;
    setLoading(true);
    setError('');
    try {
      const thinking: ThinkingConfig | undefined = thinkingEnabled
        ? { type: 'enabled', budgetTokens: thinkingBudget, effort: thinkingEffort }
        : undefined;
      const job = await api.createJob(
        projectId,
        prompt.trim(),
        sessionMode ? 'session' : undefined,
        thinking,
        attach.attachments.length > 0 ? attach.attachments : undefined,
      );
      attach.clearAll();
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
        <div
          className={`suggestion-wrapper${attach.isDragging ? ' drop-zone-active' : ''}`}
          onDragEnter={attach.handleDragEnter}
          onDragOver={attach.handleDragOver}
          onDragLeave={attach.handleDragLeave}
          onDrop={attach.handleDrop}
        >
          <textarea
            ref={textareaRef}
            className="textarea"
            placeholder="e.g. Create a Next.js app with authentication and a dashboard page..."
            value={prompt}
            onChange={suggestions.handleChange}
            onPaste={attach.handlePaste}
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
          {attach.isDragging && (
            <div className="drop-zone-overlay">
              Drop images here
            </div>
          )}
        </div>

        {/* Attachment previews */}
        <AttachmentPreview attachments={attach.attachments} onRemove={attach.removeAttachment} />
        {attach.error && (
          <p className="attachment-error">{attach.error}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={thinkingEnabled}
                  onChange={e => setThinkingEnabled(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Extended thinking</span>
              </label>
              {thinkingEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Effort:</span>
                  {EFFORT_LEVELS.map(e => (
                    <button
                      key={e.value}
                      type="button"
                      className={`btn ${thinkingEffort === e.value ? 'btn-primary' : ''}`}
                      style={{ fontSize: 11, padding: '2px 8px', minWidth: 0 }}
                      onClick={() => setThinkingEffort(e.value)}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {thinkingEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 28 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Budget:</span>
                {THINKING_BUDGET_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    className={`btn ${thinkingBudget === p.value ? 'btn-primary' : ''}`}
                    style={{ fontSize: 11, padding: '2px 8px', minWidth: 0 }}
                    onClick={() => setThinkingBudget(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
                <input
                  type="number"
                  value={thinkingBudget}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v > 0) setThinkingBudget(v);
                  }}
                  style={{
                    width: 72,
                    fontSize: 11,
                    padding: '2px 6px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    color: 'var(--text-primary)',
                  }}
                  title="Custom budget tokens"
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>tokens</span>
              </div>
            )}
          </div>
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <div className="actions">
          {/* Hidden file input for the attach button */}
          <input
            ref={attach.fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files) attach.addFiles(e.target.files);
              e.target.value = ''; // reset so same file can be re-selected
            }}
          />
          <button className="btn btn-attach" onClick={attach.openFilePicker} title="Attach images" type="button">
            <Paperclip size={14} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !prompt.trim()}>
            {loading ? 'Submitting...' : 'Submit Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
