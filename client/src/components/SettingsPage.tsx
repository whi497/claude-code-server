import { useEffect, useState } from 'react';
import { Cpu, Gauge, KeyRound, Plus, Save, Server, Settings, Trash2, X } from 'lucide-react';
import { api } from '../hooks/api';
import type { AppSettings, ModelShortcutSettings } from '../types';

const EMPTY_MODEL_SHORTCUTS: ModelShortcutSettings = {
  haiku: '',
  sonnet: '',
  opus: '',
};

const MODEL_SHORTCUT_FIELDS: Array<{
  key: keyof ModelShortcutSettings;
  label: string;
  placeholder: string;
}> = [
  { key: 'haiku', label: 'Haiku', placeholder: 'claude-3-5-haiku-20241022' },
  { key: 'sonnet', label: 'Sonnet', placeholder: 'claude-sonnet-4-6' },
  { key: 'opus', label: 'Opus', placeholder: 'claude-opus-4-6' },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelShortcuts, setModelShortcuts] = useState<ModelShortcutSettings>(EMPTY_MODEL_SHORTCUTS);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true);
  const [autoCompactWindow, setAutoCompactWindow] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getSettings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setBaseUrl(data.anthropicBaseUrl);
        setModelShortcuts(data.modelShortcuts ?? EMPTY_MODEL_SHORTCUTS);
        setCustomModels(data.customModels ?? []);
        setAutoCompactEnabled(data.claudeCode?.autoCompactEnabled ?? true);
        setAutoCompactWindow(data.claudeCode?.autoCompactWindow ? String(data.claudeCode.autoCompactWindow) : '');
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const next = await api.updateSettings({
        ...(apiKey.trim() ? { anthropicApiKey: apiKey.trim() } : {}),
        clearAnthropicApiKey: clearApiKey,
        anthropicBaseUrl: baseUrl,
        modelShortcuts,
        customModels,
        claudeCode: {
          autoCompactEnabled,
          autoCompactWindow: autoCompactWindow.trim() ? Number(autoCompactWindow.trim()) : null,
        },
      });
      setSettings(next);
      setBaseUrl(next.anthropicBaseUrl);
      setModelShortcuts(next.modelShortcuts ?? EMPTY_MODEL_SHORTCUTS);
      setCustomModels(next.customModels ?? []);
      setAutoCompactEnabled(next.claudeCode?.autoCompactEnabled ?? autoCompactEnabled);
      setAutoCompactWindow(next.claudeCode?.autoCompactWindow ? String(next.claudeCode.autoCompactWindow) : autoCompactWindow);
      setApiKey('');
      setClearApiKey(false);
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateShortcut = (key: keyof ModelShortcutSettings, value: string) => {
    setModelShortcuts(prev => ({ ...prev, [key]: value }));
  };

  const updateCustomModel = (index: number, value: string) => {
    setCustomModels(prev => prev.map((model, i) => i === index ? value : model));
  };

  const addCustomModel = () => {
    setCustomModels(prev => [...prev, '']);
  };

  const removeCustomModel = (index: number) => {
    setCustomModels(prev => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-page-shell">
          <div className="settings-loading">Loading settings...</div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="settings-page">
        <div className="settings-page-shell">
          <div className="settings-loading">{error || 'Unable to load settings.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-page-shell">
        <div className="settings-page-header">
          <div>
            <div className="settings-page-title">
              <Settings size={18} />
              <h3>General</h3>
            </div>
            <p>These settings apply to new Claude Code runs. Credentials and models are stored in `.env`; Claude Code runtime settings are stored in global settings.</p>
          </div>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <KeyRound size={15} />
            <div>
              <h4>Credentials</h4>
              <p>Configure the API key used by future Claude Agent SDK processes.</p>
            </div>
          </div>

          <div className="settings-form">
            <label className="settings-field">
              <span className="settings-label">Anthropic API Key</span>
              <input
                className="input"
                type="password"
                value={apiKey}
                disabled={clearApiKey}
                placeholder={settings.anthropicApiKeySet ? `Current: ${settings.anthropicApiKeyPreview}` : 'sk-ant-...'}
                onChange={e => setApiKey(e.target.value)}
              />
            </label>

            {settings.anthropicApiKeySet && (
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={e => setClearApiKey(e.target.checked)}
                />
                <Trash2 size={12} />
                Clear saved API key
              </label>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <Server size={15} />
            <div>
              <h4>Endpoint</h4>
              <p>Use a proxy or compatible gateway instead of the Anthropic default endpoint.</p>
            </div>
          </div>

          <label className="settings-field">
            <span className="settings-label">Base URL</span>
            <input
              className="input"
              value={baseUrl}
              placeholder="https://api.anthropic.com"
              onChange={e => setBaseUrl(e.target.value)}
            />
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <Cpu size={15} />
            <div>
              <h4>Models</h4>
              <p>Map common labels to exact model names, then add any extra model names as plain entries.</p>
            </div>
          </div>

          <div className="settings-model-shortcuts">
            {MODEL_SHORTCUT_FIELDS.map(field => (
              <label className="settings-field" key={field.key}>
                <span className="settings-label">{field.label}</span>
                <input
                  className="input"
                  value={modelShortcuts[field.key]}
                  placeholder={field.placeholder}
                  onChange={e => updateShortcut(field.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="settings-custom-models">
            <div className="settings-custom-models-header">
              <span className="settings-label">Other Models</span>
              <button className="btn settings-add-model-btn" type="button" onClick={addCustomModel}>
                <Plus size={13} />
                Add Model
              </button>
            </div>

            {customModels.length === 0 ? (
              <div className="settings-empty-models">No additional models configured.</div>
            ) : (
              <div className="settings-custom-model-list">
                {customModels.map((model, index) => (
                  <div className="settings-custom-model-row" key={index}>
                    <input
                      className="input"
                      value={model}
                      placeholder="claude-3-7-sonnet-latest"
                      onChange={e => updateCustomModel(index, e.target.value)}
                    />
                    <button
                      className="btn btn-icon settings-remove-model-btn"
                      type="button"
                      title="Remove model"
                      onClick={() => removeCustomModel(index)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <Gauge size={15} />
            <div>
              <h4>Claude Code Runtime</h4>
              <p>Global settings from {settings.claudeCode?.settingsPath ?? '~/.claude/settings.json'}</p>
            </div>
          </div>

          <div className="settings-form">
            <label className="settings-check">
              <input
                type="checkbox"
                checked={autoCompactEnabled}
                onChange={e => setAutoCompactEnabled(e.target.checked)}
              />
              Enable auto-compact
            </label>

            <label className="settings-field">
              <span className="settings-label">Auto-compact window</span>
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                value={autoCompactWindow}
                placeholder="Claude Code default"
                onChange={e => setAutoCompactWindow(e.target.value)}
              />
            </label>
          </div>
        </div>

        <p className="settings-note">
          Leave API key blank to keep the current key. Empty base URL uses the Anthropic default. Already-running sessions keep their current process settings.
        </p>
        {error && <p className="settings-error">{error}</p>}
        {saved && <p className="settings-saved">Settings saved.</p>}
      </div>
    </div>
  );
}
