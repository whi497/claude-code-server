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
  stopJob: (id: string) => request(`/jobs/${id}/stop`, { method: 'POST' }),
  continueJob: (id: string, prompt?: string) => request(`/jobs/${id}/continue`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  closeSession: (id: string) => request(`/jobs/${id}/close-session`, { method: 'POST' }),
  getFiles: (projectId: string) => request(`/projects/${projectId}/files`),
  getFile: (projectId: string, filePath: string) => request(`/projects/${projectId}/files/${filePath}`),
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
  getCron: (projectId: string) => request(`/projects/${projectId}/cron`),
};
