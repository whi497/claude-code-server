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
  getProjects: () => request('/projects'),
  createProject: (name: string, path?: string) => request('/projects', { method: 'POST', body: JSON.stringify({ name, path }) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),
  getJobs: (projectId?: string) => request(`/jobs${projectId ? `?projectId=${projectId}` : ''}`),
  getJob: (id: string) => request(`/jobs/${id}`),
  createJob: (projectId: string, prompt: string, mode?: string) => request('/jobs', { method: 'POST', body: JSON.stringify({ projectId, prompt, mode }) }),
  renameJob: (id: string, name: string) => request(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  archiveJob: (id: string) => request(`/jobs/${id}/archive`, { method: 'POST' }),
  unarchiveJob: (id: string) => request(`/jobs/${id}/unarchive`, { method: 'POST' }),
  stopJob: (id: string) => request(`/jobs/${id}/stop`, { method: 'POST' }),
  continueJob: (id: string, prompt?: string) => request(`/jobs/${id}/continue`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  closeSession: (id: string) => request(`/jobs/${id}/close-session`, { method: 'POST' }),
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
  // Search
  searchJobs: (query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', String(limit));
    return request(`/search?${params.toString()}`);
  },
};
