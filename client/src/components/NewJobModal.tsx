import { useState, useRef, useMemo } from 'react';
import { Paperclip, Cpu, MessageSquare } from 'lucide-react';
import { api } from '../hooks/api';
import { useSuggestions, type CommandDef, FALLBACK_SDK_COMMANDS } from '../hooks/useSuggestions';
import { useAttachments } from '../hooks/useAttachments';
import { SuggestionDropdown } from './SuggestionDropdown';
import { AttachmentPreview } from './AttachmentPreview';
import { ContextToolbar, ThinkingToolbar, ModelPickerModal, getModelDisplayName } from './PromptControls';
import type { Job, ThinkingConfig, ModelOption } from '../types';

interface Props {
  projectId: string;
  onClose: () => void;
  onCreated: (j: Job) => void;
}

const DEFAULT_THINKING_BUDGET = 10000;

export function NewJobModal({ projectId, onClose, onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [sessionMode, setSessionMode] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState(DEFAULT_THINKING_BUDGET);
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [contextOneMillion, setContextOneMillion] = useState(false);
  const [selectedModel, setSelectedModel] = useState('default');
  const [selectedModelDisplayName, setSelectedModelDisplayName] = useState<string | undefined>();
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelPickerLoading, setModelPickerLoading] = useState(false);
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
  });

  const handleOpenModelPicker = async () => {
    setModelPickerOpen(true);
    setModelPickerLoading(true);
    try {
      setAvailableModels(await api.getAvailableModels());
    } catch {
      setAvailableModels([]);
    } finally {
      setModelPickerLoading(false);
    }
  };

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
        contextOneMillion ? { oneMillion: true } : undefined,
        selectedModel,
        selectedModelDisplayName,
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
              if (!e.defaultPrevented && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
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

        <div className="input-toolbar-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`thinking-toolbar-toggle ${sessionMode ? 'active' : ''}`}
            onClick={() => setSessionMode(prev => !prev)}
            title={sessionMode ? 'Start as persistent session' : 'Start as regular job'}
          >
            <MessageSquare size={13} />
            <span>{sessionMode ? 'Session' : 'Job'}</span>
          </button>
          <ThinkingToolbar
            enabled={thinkingEnabled}
            effort={thinkingEffort}
            budget={thinkingBudget}
            onToggle={setThinkingEnabled}
            onEffortChange={setThinkingEffort}
            onBudgetChange={setThinkingBudget}
          />
          <ContextToolbar
            oneMillion={contextOneMillion}
            onToggle={setContextOneMillion}
          />
          <button
            type="button"
            className="model-selector-btn"
            onClick={handleOpenModelPicker}
            title="Select model"
          >
            <Cpu size={13} />
            <span>{getModelDisplayName(selectedModel, availableModels, selectedModelDisplayName)}</span>
          </button>
        </div>
        <p className="text-sm text-muted" style={{ marginTop: 8, marginBottom: 0 }}>
          Session keeps Claude alive after each turn. Jobs still auto-promote to session when cron tasks are detected.
        </p>

        <AttachmentPreview attachments={attach.attachments} onRemove={attach.removeAttachment} />
        {attach.error && (
          <p className="attachment-error">{attach.error}</p>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <div className="actions">
          <input
            ref={attach.fileInputRef as React.RefObject<HTMLInputElement>}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              if (e.target.files) attach.addFiles(e.target.files);
              e.target.value = '';
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

      <ModelPickerModal
        isOpen={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        models={availableModels}
        loading={modelPickerLoading}
        currentValue={selectedModel}
        currentDisplayName={selectedModelDisplayName}
        title="Select Model"
        emptyMessage="No models available."
        onSelect={(model) => {
          setSelectedModel(model.value);
          setSelectedModelDisplayName(model.displayName);
          setModelPickerOpen(false);
        }}
      />
    </div>
  );
}
