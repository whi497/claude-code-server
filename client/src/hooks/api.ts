const BASE = '/api';

async function request(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

export const api = {
  getSettings: (): Promise<import('../types').AppSettings> => request('/settings'),
  updateSettings: (settings: { anthropicApiKey?: string; clearAnthropicApiKey?: boolean; anthropicBaseUrl?: string; modelsText?: string }): Promise<import('../types').AppSettings> =>
    request('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  getProjects: () => request('/projects'),
  createProject: (name: string, path?: string) => request('/projects', { method: 'POST', body: JSON.stringify({ name, path }) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
  reorderProjects: (orderedIds: string[]) => request('/projects/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) }),
  getJobs: (projectId?: string) => request(`/jobs${projectId ? `?projectId=${projectId}` : ''}`),
  getJob: (id: string) => request(`/jobs/${id}`),
  createJob: (projectId: string, prompt: string, mode?: string, thinking?: { type: 'disabled' } | { type: 'enabled'; budgetTokens: number; effort?: string }, model?: string, attachments?: import('../types').Attachment[]) => request('/jobs', { method: 'POST', body: JSON.stringify({ projectId, prompt, mode, thinking, ...(model ? { model } : {}), ...(attachments?.length ? { attachments } : {}) }) }),
  renameJob: (id: string, name: string) => request(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  archiveJob: (id: string) => request(`/jobs/${id}/archive`, { method: 'POST' }),
  unarchiveJob: (id: string) => request(`/jobs/${id}/unarchive`, { method: 'POST' }),
  stopJob: (id: string) => request(`/jobs/${id}/stop`, { method: 'POST' }),
  continueJob: (id: string, prompt?: string, thinking?: { type: 'disabled' } | { type: 'enabled'; budgetTokens: number; effort?: string }, model?: string, attachments?: import('../types').Attachment[]) => request(`/jobs/${id}/continue`, { method: 'POST', body: JSON.stringify({ prompt, thinking, ...(model ? { model } : {}), ...(attachments?.length ? { attachments } : {}) }) }),
  updateJobThinking: (id: string, thinking: { type: 'disabled' } | { type: 'enabled'; budgetTokens: number; effort?: string } | null) => request(`/jobs/${id}/thinking`, { method: 'PUT', body: JSON.stringify({ thinking }) }),
  forkJob: (id: string, body: { prompt: string; forkPoint: { type: 'after_assistant' | 'edit_user'; turnIndex: number } }): Promise<{ id: string }> =>
    request(`/jobs/${id}/fork`, { method: 'POST', body: JSON.stringify(body) }),
  closeSession: (id: string) => request(`/jobs/${id}/close-session`, { method: 'POST' }),
  keepAlive: (id: string) => request(`/jobs/${id}/keep-alive`, { method: 'POST' }),
  completeNow: (id: string) => request(`/jobs/${id}/complete-now`, { method: 'POST' }),
  getFiles: (projectId: string) => request(`/projects/${projectId}/files`),
  getFile: (projectId: string, filePath: string) => request(`/projects/${projectId}/files/${filePath}`),
  searchFiles: (projectId: string, query: string, searchContent = true) => {
    const params = new URLSearchParams({ q: query });
    if (!searchContent) params.set('content', 'false');
    return request(`/projects/${projectId}/files-search?${params.toString()}`);
  },
  // Approvals
  getApprovals: (status?: string, jobId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (jobId) params.set('jobId', jobId);
    const qs = params.toString();
    return request(`/approvals${qs ? `?${qs}` : ''}`);
  },
  respondToApproval: (id: string, body: { action: string; text?: string }) =>
    request(`/approvals/${id}/respond`, { method: 'POST', body: JSON.stringify(body) }),
  // Memories
  getMemories: (projectId: string) => request(`/projects/${projectId}/memories`),
  saveMemory: (projectId: string, filePath: string, content: string) =>
    request(`/projects/${projectId}/memories`, { method: 'PUT', body: JSON.stringify({ filePath, content }) }),
  // Cron
  getCron: (projectId: string, jobId?: string) => request(`/projects/${projectId}/cron${jobId ? `?jobId=${jobId}` : ''}`),
  // Git
  getGitStatus: (projectId: string) => request(`/projects/${projectId}/git/status`),
  getGitDiff: (projectId: string, file?: string, staged?: boolean) => {
    const params = new URLSearchParams();
    if (file) params.set('file', file);
    if (staged) params.set('staged', 'true');
    const qs = params.toString();
    return request(`/projects/${projectId}/git/diff${qs ? `?${qs}` : ''}`);
  },
  gitAction: (projectId: string, action: string, payload?: { files?: string[]; message?: string }) =>
    request(`/projects/${projectId}/git/action`, { method: 'POST', body: JSON.stringify({ action, ...payload }) }),
  // Slash commands (from SDK session)
  getCommands: (jobId: string): Promise<{ name: string; description: string; argumentHint: string }[]> =>
    request(`/jobs/${jobId}/commands`),
  // Model operations (server-handled, not SDK slash commands)
  getModels: (jobId: string): Promise<import('../types').ModelOption[]> =>
    request(`/jobs/${jobId}/models`),
  getAvailableModels: (): Promise<import('../types').ModelOption[]> =>
    request('/models'),
  switchModel: (jobId: string, model: string) =>
    request(`/jobs/${jobId}/model`, { method: 'POST', body: JSON.stringify({ model }) }),
  // Search
  searchJobs: (query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', String(limit));
    return request(`/search?${params.toString()}`);
  },
  // Project archive
  archiveProject: (id: string) => request(`/projects/${id}/archive`, { method: 'POST' }),
  unarchiveProject: (id: string) => request(`/projects/${id}/unarchive`, { method: 'POST' }),
  // Import from local Claude sessions
  discoverLocalProjects: (query?: string, refresh?: boolean) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (refresh) params.set('refresh', 'true');
    const qs = params.toString();
    return request(`/import/discover${qs ? `?${qs}` : ''}`);
  },
  importProjects: (selections: Array<{ dirName: string; sessions: string[] }>) =>
    request('/import/projects', { method: 'POST', body: JSON.stringify({ selections }) }),
};
