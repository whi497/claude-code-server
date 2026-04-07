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
  archiveJob: (id: string) => request(`/jobs/${id}/archive`, { method: 'POST' }),
  stopJob: (id: string) => request(`/jobs/${id}/stop`, { method: 'POST' }),
  continueJob: (id: string, prompt?: string) => request(`/jobs/${id}/continue`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  closeSession: (id: string) => request(`/jobs/${id}/close-session`, { method: 'POST' }),
  getFiles: (projectId: string) => request(`/projects/${projectId}/files`),
  getFile: (projectId: string, filePath: string) => request(`/projects/${projectId}/files/${filePath}`),
};
