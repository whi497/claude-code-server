import { useEffect, useState } from 'react';
import { Cpu, KeyRound, Save, Server, Settings, Trash2 } from 'lucide-react';
import { api } from '../hooks/api';
import type { AppSettings } from '../types';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelsText, setModelsText] = useState('');
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
        setModelsText(data.modelsText);
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
        modelsText,
      });
      setSettings(next);
      setBaseUrl(next.anthropicBaseUrl);
      setModelsText(next.modelsText);
      setApiKey('');
      setClearApiKey(false);
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
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
            <p>These settings are persisted to the worktree `.env` file and apply to new Claude Code runs.</p>
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
              <p>Override the model list shown in model pickers. Leave blank to use SDK discovery and fallback options.</p>
            </div>
          </div>

          <label className="settings-field">
            <span className="settings-label">Available Models</span>
            <textarea
              className="textarea settings-models-input"
              value={modelsText}
              placeholder={'sonnet\nopus\nhaiku\nclaude-3-5-sonnet-latest | Sonnet 3.5 | Balanced coding model'}
              onChange={e => setModelsText(e.target.value)}
              rows={8}
            />
          </label>
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
