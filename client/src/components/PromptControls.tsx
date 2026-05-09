import { useEffect, useState } from 'react';
import { Brain, Maximize2 } from 'lucide-react';
import type { EffortLevel, ModelOption } from '../types';

const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Lo' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'Hi' },
];

const BUDGET_PRESETS = [
  { label: '10k', value: 10000 },
  { label: '50k', value: 50000 },
  { label: '100k', value: 100000 },
];

interface ThinkingToolbarProps {
  enabled: boolean;
  effort: EffortLevel;
  budget: number;
  onToggle: (enabled: boolean) => void;
  onEffortChange: (effort: EffortLevel) => void;
  onBudgetChange: (budget: number) => void;
}

export function ThinkingToolbar({ enabled, effort, budget, onToggle, onEffortChange, onBudgetChange }: ThinkingToolbarProps) {
  const [showBudget, setShowBudget] = useState(false);

  return (
    <div className="thinking-toolbar">
      <button
        type="button"
        className={`thinking-toolbar-toggle ${enabled ? 'active' : ''}`}
        onClick={() => onToggle(!enabled)}
        title={enabled ? 'Disable extended thinking' : 'Enable extended thinking'}
      >
        <Brain size={13} />
        <span>{enabled ? 'Thinking' : 'Think'}</span>
      </button>
      {enabled && (
        <>
          <div className="thinking-toolbar-effort">
            {EFFORT_LEVELS.map(e => (
              <button
                key={e.value}
                type="button"
                className={`thinking-effort-btn ${effort === e.value ? 'active' : ''}`}
                onClick={() => onEffortChange(e.value)}
                title={`${e.value} effort`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`thinking-toolbar-budget-toggle ${showBudget ? 'active' : ''}`}
            onClick={() => setShowBudget(!showBudget)}
            title="Adjust token budget"
          >
            {(budget / 1000).toFixed(0)}k
          </button>
          {showBudget && (
            <div className="thinking-toolbar-budget">
              {BUDGET_PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className={`thinking-budget-btn ${budget === p.value ? 'active' : ''}`}
                  onClick={() => onBudgetChange(p.value)}
                >
                  {p.label}
                </button>
              ))}
              <input
                type="number"
                value={budget}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) onBudgetChange(v);
                }}
                className="thinking-budget-input"
                title="Custom token budget"
                onClick={e => e.stopPropagation()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ContextToolbarProps {
  oneMillion: boolean;
  onToggle: (enabled: boolean) => void;
}

export function ContextToolbar({ oneMillion, onToggle }: ContextToolbarProps) {
  return (
    <button
      type="button"
      className={`context-toolbar-toggle ${oneMillion ? 'active' : ''}`}
      onClick={() => onToggle(!oneMillion)}
      title={oneMillion ? 'Disable 1M context' : 'Enable 1M context'}
    >
      <Maximize2 size={12} />
      <span>1M</span>
    </button>
  );
}

interface ModelPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: ModelOption[];
  loading: boolean;
  currentValue?: string;
  currentDisplayName?: string;
  title?: string;
  emptyMessage?: string;
  onSelect: (model: ModelOption) => void;
}

export function ModelPickerModal({
  isOpen,
  onClose,
  models,
  loading,
  currentValue = 'default',
  currentDisplayName,
  title = 'Select Model',
  emptyMessage = 'No models available.',
  onSelect,
}: ModelPickerModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const currentIndex = models.findIndex(m =>
      m.value === currentValue && (!currentDisplayName || m.displayName === currentDisplayName)
    );
    setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [isOpen, models, currentValue, currentDisplayName]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (models.length === 0) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => (i + 1) % models.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => (i - 1 + models.length) % models.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); onSelect(models[selectedIndex]); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, models, selectedIndex, onClose, onSelect]);

  if (!isOpen) return null;

  return (
    <div className="fork-modal-overlay" onClick={onClose}>
      <div className="fork-modal model-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="fork-modal-header">{title}</div>
        {loading ? (
          <div className="model-picker-loading">Loading models...</div>
        ) : models.length === 0 ? (
          <div className="model-picker-loading">{emptyMessage}</div>
        ) : (
          <div className="model-picker-list">
            {models.map((m, i) => (
              <div
                key={`${m.displayName}:${m.value}:${i}`}
                className={`model-picker-item${i === selectedIndex ? ' selected' : ''}`}
                onClick={() => onSelect(m)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="model-picker-item-name">{m.displayName}</div>
                <div className="model-picker-item-desc">{m.description}</div>
              </div>
            ))}
          </div>
        )}
        <div className="model-picker-footer">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}

export function getModelDisplayName(modelValue: string | undefined, models: ModelOption[], modelDisplayName?: string) {
  if (!modelValue || modelValue === 'default') return 'Model';
  if (modelDisplayName) return modelDisplayName;
  return models.find(m => m.value === modelValue)?.displayName || modelValue;
}
