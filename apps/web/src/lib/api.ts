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
  getTeam: () => api.get('/auth/team'),
  invite: (data: { email: string; firstName: string; lastName: string; role?: string; tempPassword: string }) =>
    api.post('/auth/invite', data),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  resetPasswordWithToken: (token: string, newPassword: string) =>
    api.post('/auth/reset-password', { token, newPassword }),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.patch('/auth/password', data),
  resetPassword: (userId: string, newPassword: string) =>
    api.patch(`/auth/team/${userId}/password`, { newPassword }),
  removeUser: (userId: string) =>
    api.delete(`/auth/team/${userId}`),
  updateTeamMember: (userId: string, data: { firstName?: string; lastName?: string; phone?: string; title?: string; role?: string }) =>
    api.patch(`/auth/team/${userId}`, data),
  updateOrganization: (name: string) =>
    api.patch('/auth/organization', { name }),
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
  toggleAutoRespond: (id: string, autoRespond: boolean) =>
    api.patch(`/leads/${id}/auto-respond`, { autoRespond }),
  refreshPropertyDetails: (id: string) =>
    api.post(`/leads/${id}/property-details/refresh`),
  assign: (id: string, userId: string, stage: string) =>
    api.patch(`/leads/${id}/assign`, { userId, stage }),
  unassign: (id: string) =>
    api.patch(`/leads/${id}/unassign`),
  sendOutreach: (id: string) => api.post(`/leads/${id}/send-outreach`),
  bulkDelete: (ids: string[]) => api.post('/leads/bulk-delete', { ids }),
  bulkUpdateStatus: (ids: string[], status: string) =>
    api.post('/leads/bulk-status', { ids, status }),
  bulkUpdateSource: (ids: string[], source: string) =>
    api.post('/leads/bulk-source', { ids, source }),
  exportCsv: (filters: any) =>
    api.post('/leads/export-csv', filters, { responseType: 'blob' }),
  exportLeads: (filters: any, fields?: string[], format?: 'csv' | 'xlsx') =>
    api.post('/leads/export', { filters, fields, format }, { responseType: 'blob' }),
  importParse: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/leads/import/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importExecute: (file: File, mapping: Record<string, string>, options?: any) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    formData.append('options', JSON.stringify(options || {}));
    return api.post('/leads/import/execute', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importFields: () => api.get('/leads/import/fields'),
  stats: () => api.get('/leads/stats'),
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
  simulateReply: (leadId: string, message: string) =>
    api.post(`/leads/${leadId}/messages/simulate-reply`, { message }),
};

// Comps API
export const compsAPI = {
  fetch: (leadId: string, forceRefresh?: boolean, source?: string) => {
    const params = new URLSearchParams();
    if (forceRefresh) params.set('forceRefresh', 'true');
    if (source) params.set('source', source);
    const qs = params.toString();
    return api.post(`/leads/${leadId}/comps${qs ? `?${qs}` : ''}`);
  },
  list: (leadId: string) => api.get(`/leads/${leadId}/comps`),
  toggleComp: (leadId: string, compId: string) =>
    api.post(`/leads/${leadId}/comps/${compId}/toggle`),
  autoSelect: (leadId: string, minSimilarity: number, maxDistance: number) =>
    api.post(`/leads/${leadId}/comps/auto-select`, { minSimilarity, maxDistance }),
  attomEnrich: (leadId: string, forceRefresh?: boolean) =>
    api.post(`/leads/${leadId}/comps/attom-enrich${forceRefresh ? '?forceRefresh=true' : ''}`),
  getAttomData: (leadId: string) =>
    api.get(`/leads/${leadId}/comps/attom-data`),
};

// Comp Analysis API
export const compAnalysisAPI = {
  create: (leadId: string, params?: any) =>
    api.post(`/leads/${leadId}/comp-analysis`, params || {}),
  list: (leadId: string) => api.get(`/leads/${leadId}/comp-analysis`),
  get: (leadId: string, analysisId: string) =>
    api.get(`/leads/${leadId}/comp-analysis/${analysisId}`),
  update: (leadId: string, analysisId: string, data: any) =>
    api.patch(`/leads/${leadId}/comp-analysis/${analysisId}`, data),
  addComp: (leadId: string, analysisId: string, data: any) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/comps`, data),
  updateComp: (leadId: string, analysisId: string, compId: string, data: any) =>
    api.patch(`/leads/${leadId}/comp-analysis/${analysisId}/comps/${compId}`, data),
  deleteComp: (leadId: string, analysisId: string, compId: string) =>
    api.delete(`/leads/${leadId}/comp-analysis/${analysisId}/comps/${compId}`),
  toggleComp: (leadId: string, analysisId: string, compId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/comps/${compId}/toggle`),
  selectAll: (leadId: string, analysisId: string, selected: boolean, source?: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/comps/select-all`, { selected, source }),
  calculateAdjustments: (leadId: string, analysisId: string, config?: any) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/calculate-adjustments`, { config }),
  calculateArv: (leadId: string, analysisId: string, method?: string, preserveAiArv?: boolean) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/calculate-arv`, { method, preserveAiArv }),
  aiAdjustComps: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/ai-adjust-comps`),
  aiSummary: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/ai-summary`),
  estimateRepairs: (leadId: string, analysisId: string, data: any) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/estimate-repairs`, data),
  calculateDeal: (leadId: string, analysisId: string, data: any) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/calculate-deal`, data),
  saveToLead: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/save-to-lead`),
  generateAssessment: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/assessment`),
  dealIntelligence: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/deal-intelligence`),
  analyzePhotos: (leadId: string, analysisId: string, formData: FormData) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/analyze-photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// Dashboard API
export const dashboardAPI = {
  stats: () => api.get('/dashboard/stats'),
  activity: (limit?: number) => api.get('/dashboard/activity', { params: { limit } }),
  tasks: (userId?: string) => api.get('/dashboard/tasks', { params: { userId } }),
  hotLeads: (limit?: number) => api.get('/dashboard/hot-leads', { params: { limit } }),
  staleLeads: (limit?: number) => api.get('/dashboard/stale-leads', { params: { limit } }),
  newLeads: (limit?: number) => api.get('/dashboard/new-leads', { params: { limit } }),
};

// Settings API
export const settingsAPI = {
  getDrip: () => api.get('/settings/drip'),
  updateDrip: (data: {
    initialDelayMs?: number;
    nextQuestionDelayMs?: number;
    retryDelayMs?: number;
    maxRetries?: number;
    demoMode?: boolean;
    aiSmsEnabled?: boolean;
    aiCallEnabled?: boolean;
    callDelayMs?: number;
  }) => api.patch('/settings/drip', data),
  sendDemoLead: () => api.post('/settings/drip/demo-lead'),
  getProfile: () => api.get('/settings/profile'),
  updateProfile: (data: { firstName?: string; lastName?: string; avatarUrl?: string }) =>
    api.patch('/settings/profile', data),
  uploadAvatar: (base64: string) =>
    api.post('/settings/profile/avatar', { base64 }),
};

// Prompts API
export const promptsAPI = {
  list: () => api.get('/settings/prompts'),
  get: (id: string) => api.get(`/settings/prompts/${id}`),
  create: (data: any) => api.post('/settings/prompts', data),
  update: (id: string, data: any) => api.patch(`/settings/prompts/${id}`, data),
  delete: (id: string) => api.delete(`/settings/prompts/${id}`),
  test: (id: string) => api.post(`/settings/prompts/${id}/test`),
};

// Tasks API
export const tasksAPI = {
  complete: (id: string, userId?: string) =>
    api.post(`/tasks/${id}/complete`, { userId }),
};

// Pipeline API
export const pipelineAPI = {
  get: () => api.get('/pipeline'),
  updateStage: (id: string, stage: string) =>
    api.patch(`/pipeline/leads/${id}/stage`, { stage }),
  getInsights: () => api.post('/pipeline/insights'),
  getLeadAnalysis: (id: string) => api.get(`/pipeline/leads/${id}/analysis`),
  refreshLeadAnalysis: (id: string) => api.post(`/pipeline/leads/${id}/analysis/refresh`),
};

// Calls API
export const callsAPI = {
  initiateAiCall: (leadId: string) =>
    api.post('/calls/ai-initiate', { leadId }),
};

// Photos API
export const photosAPI = {
  fetchAll: (leadId: string) =>
    api.post(`/leads/${leadId}/photos/fetch-all`),
  fetchStreetView: (leadId: string) =>
    api.post(`/leads/${leadId}/photos/streetview`),
  upload: (leadId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/leads/${leadId}/photos/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadMultiple: (leadId: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('photos', file));
    return api.post(`/leads/${leadId}/photos/upload-multiple`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  addFromUrl: (leadId: string, url: string, caption?: string) =>
    api.post(`/leads/${leadId}/photos/url`, { url, caption }),
  delete: (leadId: string, photoId: string) =>
    api.delete(`/leads/${leadId}/photos/${photoId}`),
  setPrimary: (leadId: string, photoId: string) =>
    api.patch(`/leads/${leadId}/photos/primary`, { photoId }),
};

// Gmail API
export const gmailAPI = {
  // Per-user Gmail
  status: () => api.get('/gmail/status'),
  send: (data: { leadId?: string; to: string; subject: string; bodyHtml?: string; bodyText: string }) =>
    api.post('/gmail/send', data),
  sync: () => api.post('/gmail/sync'),
  emails: (leadId: string) => api.get(`/gmail/emails/${leadId}`),
  disconnect: () => api.delete('/gmail/disconnect'),
  getAuthUrl: () => `${API_URL}/auth/gmail`,
  // Org-level shared Gmail
  orgStatus: () => api.get('/gmail/org-status'),
  orgSend: (data: { leadId?: string; to: string; subject: string; bodyHtml?: string; bodyText: string }) =>
    api.post('/gmail/org-send', data),
  orgSync: () => api.post('/gmail/org-sync'),
  orgDisconnect: () => api.delete('/gmail/org-disconnect'),
  getOrgAuthUrl: () => `${API_URL}/auth/org-gmail`,
};

export const boldSignAPI = {
  send: (leadId: string, templateType: 'purchase' | 'aif') =>
    api.post(`/leads/${leadId}/boldsign/send`, { templateType }),
  status: (leadId: string) => api.get(`/leads/${leadId}/boldsign/status`),
  templates: () => api.get('/boldsign/templates'),
};

// Campaign / Drip Campaign API
export const campaignAPI = {
  list: () => api.get('/campaigns'),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: any) => api.post('/campaigns', data),
  update: (id: string, data: any) => api.put(`/campaigns/${id}`, data),
  delete: (id: string) => api.delete(`/campaigns/${id}`),
  duplicate: (id: string) => api.post(`/campaigns/${id}/duplicate`),
  toggle: (id: string, isActive: boolean) =>
    api.patch(`/campaigns/${id}/toggle`, { isActive }),
  enrollLead: (id: string, leadId: string) =>
    api.post(`/campaigns/${id}/enroll/${leadId}`),
  unenroll: (enrollmentId: string) =>
    api.delete(`/campaigns/enrollments/${enrollmentId}`),
  pause: (enrollmentId: string) =>
    api.patch(`/campaigns/enrollments/${enrollmentId}/pause`),
  resume: (enrollmentId: string) =>
    api.patch(`/campaigns/enrollments/${enrollmentId}/resume`),
  enrollments: (id: string, status?: string) =>
    api.get(`/campaigns/${id}/enrollments`, { params: { status } }),
  stats: (id: string) => api.get(`/campaigns/${id}/stats`),
  leadCampaigns: (leadId: string) => api.get(`/leads/${leadId}/campaigns`),
  aiSuggest: (data: any) => api.post('/campaigns/ai/suggest', data),
  aiImprove: (data: any) => api.post('/campaigns/ai/improve', data),
  aiGenerateSequence: (data: any) =>
    api.post('/campaigns/ai/generate-sequence', data),
};

// Deal Search API
export const dealSearchAPI = {
  search: (filters: any, page?: number, pageSize?: number) =>
    api.post('/deal-search/search', { filters, page, pageSize }),
  getProperty: (attomId: string, address: { street: string; city: string; state: string; zip: string }) =>
    api.get(`/deal-search/property/${attomId}`, { params: address }),
  addToPipeline: (data: any) =>
    api.post('/deal-search/add-to-pipeline', data),
  saveSearch: (name: string, filters: any) =>
    api.post('/deal-search/saved-searches', { name, filters }),
  listSavedSearches: () =>
    api.get('/deal-search/saved-searches'),
  deleteSavedSearch: (id: string) =>
    api.delete(`/deal-search/saved-searches/${id}`),
  exportCsv: (filters: any) =>
    api.post('/deal-search/export-csv', { filters }, { responseType: 'blob' }),
  skipTrace: (attomId: string) =>
    api.post('/deal-search/skip-trace', { attomId }),
};

export const dispoAPI = {
  getSummary: (leadId: string) => api.get(`/leads/${leadId}/dispo`),
  updateDealNumbers: (leadId: string, data: { arv?: number | null; repairCosts?: number | null; askingPrice?: number | null; assignmentFee?: number | null; maoPercent?: number | null }) =>
    api.patch(`/leads/${leadId}`, data),
  upsertContract: (leadId: string, data: any) => api.post(`/leads/${leadId}/contract`, data),
  createOffer: (leadId: string, data: any) => api.post(`/leads/${leadId}/offers`, data),
  updateOffer: (leadId: string, offerId: string, data: any) => api.patch(`/leads/${leadId}/offers/${offerId}`, data),
  deleteOffer: (leadId: string, offerId: string) => api.delete(`/leads/${leadId}/offers/${offerId}`),
};
