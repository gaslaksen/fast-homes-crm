import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;

// Auth API
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (data: { email: string; password: string; firstName: string; lastName: string }) =>
    api.post('/auth/register', data),
  getMe: () => api.get('/auth/me'),
};

// Leads API
export const leadsAPI = {
  list: (params?: any) => api.get('/leads', { params }),
  get: (id: string) => api.get(`/leads/${id}`),
  create: (data: any) => api.post('/leads', data),
  update: (id: string, data: any) => api.patch(`/leads/${id}`, data),
  createTask: (id: string, data: any) => api.post(`/leads/${id}/tasks`, data),
  addNote: (id: string, content: string, userId: string) =>
    api.post(`/leads/${id}/notes`, { content, userId }),
  upsertContract: (id: string, data: any) => api.post(`/leads/${id}/contract`, data),
};

// Messages API
export const messagesAPI = {
  list: (leadId: string) => api.get(`/leads/${leadId}/messages`),
  draft: (leadId: string, context?: string) =>
    api.post(`/leads/${leadId}/messages/draft`, { context }),
  send: (leadId: string, message: string, userId?: string) =>
    api.post(`/leads/${leadId}/messages/send`, { message, userId }),
  rescore: (leadId: string, userId?: string) =>
    api.post(`/leads/${leadId}/messages/rescore`, { userId }),
};

// Comps API
export const compsAPI = {
  fetch: (leadId: string) => api.post(`/leads/${leadId}/comps`),
  list: (leadId: string) => api.get(`/leads/${leadId}/comps`),
};

// Dashboard API
export const dashboardAPI = {
  stats: () => api.get('/dashboard/stats'),
  activity: (limit?: number) => api.get('/dashboard/activity', { params: { limit } }),
  tasks: (userId?: string) => api.get('/dashboard/tasks', { params: { userId } }),
  hotLeads: (limit?: number) => api.get('/dashboard/hot-leads', { params: { limit } }),
};

// Tasks API
export const tasksAPI = {
  complete: (id: string, userId?: string) =>
    api.post(`/tasks/${id}/complete`, { userId }),
};
