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
// The companies the signed-in user can switch between, each with its pipelines.
export const companiesAPI = {
  list: () => api.get('/companies'),
};

export const leadsAPI = {
  list: (params?: any) => api.get('/leads', { params }),
  pipeline: (params?: any) => api.get('/leads/pipeline', { params }),
  get: (id: string) => api.get(`/leads/${id}`),
  create: (data: any) => api.post('/leads', data),
  update: (id: string, data: any) => api.patch(`/leads/${id}`, data),
  getTasks: (id: string) => api.get(`/leads/${id}/tasks`),
  createTask: (id: string, data: any) => api.post(`/leads/${id}/tasks`, data),
  addNote: (
    id: string,
    content: string,
    userId: string,
    opts?: { isInternalComment?: boolean; mentions?: string[] },
  ) => api.post(`/leads/${id}/notes`, { content, userId, ...opts }),
  /** Only the note's author or an admin may; the API refuses anyone else. */
  editNote: (id: string, noteId: string, content: string) => api.patch(`/leads/${id}/notes/${noteId}`, { content }),
  deleteNote: (id: string, noteId: string) => api.delete(`/leads/${id}/notes/${noteId}`),
  upsertContract: (id: string, data: any) => api.post(`/leads/${id}/contract`, data),
  toggleAutoRespond: (id: string, autoRespond: boolean) =>
    api.patch(`/leads/${id}/auto-respond`, { autoRespond }),
  refreshPropertyDetails: (id: string) =>
    api.post(`/leads/${id}/property-details/refresh`),
  // Promote a skip-traced number to primary, so drip and the AI use it too
  setPrimaryPhone: (id: string, number: string) =>
    api.patch(`/leads/${id}/primary-phone`, { number }),
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
  getAiInsight: (id: string, regenerate?: boolean) =>
    api.get(`/leads/${id}/ai-insight${regenerate ? '?regenerate=1' : ''}`),
  getAlertDismissals: (id: string) => api.get(`/leads/${id}/alert-dismissals`),
  dismissAlert: (id: string, ruleId: string, fingerprint: string) =>
    api.post(`/leads/${id}/alert-dismissals`, { ruleId, fingerprint }),
  cancelDrip: (id: string, reason?: string) => api.post(`/leads/${id}/drip/cancel`, { reason }),
  /** Every number and address on file, with the reasons not to use each. */
  contacts: (id: string) => api.get(`/leads/${id}/contacts`),
  /**
   * Replace the contacts. The whole list is sent, primary first: the slots
   * behind this are positional and shared with the skip trace, so adding to
   * "the first empty one" races with a trace writing the same slots.
   */
  setContacts: (id: string, body: { phones?: { number: string; type?: string | null }[]; emails?: string[] }) =>
    api.put(`/leads/${id}/contacts`, body),
  /** Mark a number or address as one that does not reach them, or clear it. */
  flagContact: (id: string, value: string, bad: boolean) =>
    api.post(`/leads/${id}/contacts/flag`, { value, bad }),
  communications: (id: string) => api.get(`/leads/${id}/communications`),
};

// Foreclosures API
export const foreclosuresAPI = {
  list: (params?: any) => api.get('/foreclosures', { params }),
  ids: (params?: any) => api.get('/foreclosures/ids', { params }),
  stats: () => api.get('/foreclosures/stats'),
  mergeDuplicates: (apply: boolean) => api.post('/foreclosures/merge-duplicates', { apply }),
  get: (id: string) => api.get(`/foreclosures/${id}`),
  update: (id: string, data: any) => api.patch(`/foreclosures/${id}`, data),
  bulkDelete: (ids: string[]) => api.post('/foreclosures/bulk-delete', { ids }),
  bulkStatus: (ids: string[], status: string) =>
    api.post('/foreclosures/bulk-status', { ids, status }),
  bulkSkiptrace: (ids: string[]) => api.post('/foreclosures/bulk-skiptrace', { ids }),
  refresh: () => api.post('/foreclosures/refresh'),
  skiptrace: (id: string) => api.post(`/foreclosures/${id}/skiptrace`),
  setSignalAction: (signalId: string, action: string, completed: boolean) =>
    api.patch(`/foreclosures/signals/${signalId}/actions`, { action, completed }),
  importParse: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/foreclosures/import/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importExecute: (file: File, options?: any) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options) formData.append('options', JSON.stringify(options));
    return api.post('/foreclosures/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadPdf: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/foreclosures/upload-pdf', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Tax Sales API. One card per delinquent tax foreclosure filing.
export const taxSalesAPI = {
  list: (params?: any) => api.get('/tax-sales', { params }),
  stats: () => api.get('/tax-sales/stats'),
  get: (id: string) => api.get(`/tax-sales/${id}`),
  create: (data: any) => api.post('/tax-sales', data),
  update: (id: string, data: any) => api.patch(`/tax-sales/${id}`, data),
  bulkDelete: (ids: string[]) => api.post('/tax-sales/bulk-delete', { ids }),
  bulkStatus: (ids: string[], status: string) =>
    api.post('/tax-sales/bulk-status', { ids, status }),
  importParse: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/tax-sales/import/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importExecute: (file: File, options?: any) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options) Object.entries(options).forEach(([k, v]) => formData.append(k, String(v)));
    return api.post('/tax-sales/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Surplus Funds API. Florida overage claims; every row carries a compliance
// verdict, because whether a contract may be sent is a server decision.
export const surplusAPI = {
  list: (params?: any) => api.get('/surplus', { params }),
  stats: () => api.get('/surplus/stats'),
  complianceRules: () => api.get('/surplus/compliance-rules'),
  get: (id: string) => api.get(`/surplus/${id}`),
  create: (data: any) => api.post('/surplus', data),
  update: (id: string, data: any) => api.patch(`/surplus/${id}`, data),
  bulkDelete: (ids: string[]) => api.post('/surplus/bulk-delete', { ids }),
  bulkStage: (
    ids: string[],
    stage: string,
    dead?: { deadReason?: string | null; deadNote?: string | null; deadOverride?: boolean },
  ) => api.post('/surplus/bulk-stage', { ids, stage, ...(dead || {}) }),
  letterMailed: (
    ids: string[],
    data: {
      mailedAt?: string | null;
      address?: string | null;
      note?: string | null;
      /** 'standard' | 'priority' | 'fedex' */
      mailType?: string | null;
      trackingNumber?: string | null;
      templateKind?: string | null;
      templateVersion?: number | null;
      recipientName?: string | null;
      /** The envelope went to this heir rather than the claimant. */
      heirId?: string | null;
    } = {},
  ) => api.post('/surplus/letter-mailed', { ids, ...data }),
  /** Put a file on hold with a reason, or release it. A held file is not worked and its drips wait. */
  /** A revisit date ("2027-04-29") makes the hold a pause, which the daily cadence ends. */
  hold: (id: string, on: boolean, reason?: string, until?: string) =>
    api.post(`/surplus/${id}/hold`, { on, reason, ...(until ? { until } : {}) }),
  /** Pause several cases with one reason and one revisit date. */
  bulkHold: (ids: string[], reason: string, until?: string | null) =>
    api.post('/surplus/bulk-hold', { ids, reason, until: until || null }),
  /** The weekly prune: four buckets of cases the course says to stop working, each with its action. */
  prune: () => api.get('/surplus/prune'),
  /** The Work today session: the rifle list in the course's order, candidates, and today's calls against the target. */
  session: (size: number, county?: string | null) =>
    api.get('/surplus/session', { params: { size, county: county || undefined } }),
  /** Add to and take off the rifle list. */
  setRifle: (change: { add?: string[]; remove?: string[] }) => api.post('/surplus/rifle', change),
  /** Who on the team owns the case; null clears it. */
  setOwner: (id: string, userId: string | null) => api.post(`/surplus/${id}/owner`, { userId }),
  /** Set the next action, or rewrite the current one in place with its taskId. */
  setNextAction: (id: string, body: { title: string; dueDate: string; userId?: string | null; taskId?: string | null }) =>
    api.post(`/surplus/${id}/next-action`, body),
  /** An envelope came back undeliverable (or undo it): that address is not mailed again. */
  letterReturned: (letterId: string, returned: boolean) =>
    api.post(`/surplus/letters/${letterId}/returned`, { returned }),
  /** Take one envelope out of a claimant's letter history. */
  deleteLetter: (letterId: string) => api.post(`/surplus/letters/${letterId}/delete`),
  /** A rendered letter for the print view. Records nothing. */
  letter: (id: string, kind: string, heirId?: string | null) =>
    api.get(`/surplus/${id}/letter`, { params: { kind, heirId: heirId || undefined } }),
  /** Confirm or reject a possible obituary match for one claimant. */
  resolveObituary: (leadId: string, answer: 'confirm' | 'reject') =>
    api.post(`/surplus/${leadId}/obituary`, { answer }),
  /**
   * Pull the county docket now. This is what actually contacts Duval; the
   * board's own refresh only re-reads our database.
   *
   * `reread` re-reads the Notice of Surplus Funds on cases that already have an
   * owner address. Costs a vision call per case, so it is for correcting
   * addresses after an extractor change, not for a routine pull.
   */
  poll: (body: { source?: string; limit?: number; reread?: boolean; full?: boolean }) =>
    api.post('/surplus/poll', body),
  pollRuns: () => api.get('/surplus/poll-runs'),
  /** Connect rate by weekday and hour over the last 90 days of surplus calls. */
  callStats: () => api.get('/surplus/call-stats'),

  // ── Scripts and letters, versioned ──
  /** The scripts for one claimant, merge fields filled, plus on-screen facts. */
  script: (id: string) => api.get(`/surplus/${id}/script`),
  /** The active text of every kind, for one county (its own text wins) or in general. */
  templates: (county?: string | null) => api.get('/surplus/templates', { params: { county: county || undefined } }),
  templateVersions: (kind: string, county?: string | null) =>
    api.get(`/surplus/templates/${kind}/versions`, { params: { county: county || undefined } }),
  saveTemplate: (
    kind: string,
    data: { body: string; name?: string; subject?: string; notes?: string; county?: string | null },
  ) => api.post(`/surplus/templates/${kind}`, data),
  activateTemplate: (kind: string, version: number, county?: string | null) =>
    api.post(`/surplus/templates/${kind}/activate`, { version, county: county || null }),

  // ── Counties: what each clerk requires to file ──
  counties: () => api.get('/surplus/counties'),
  createCounty: (name: string) => api.post('/surplus/counties', { name }),
  updateCounty: (id: string, data: any) => api.patch(`/surplus/counties/${id}`, data),
  /** The answers were just checked with the clerk. Resets the staleness clock. */
  verifyCounty: (id: string) => api.post(`/surplus/counties/${id}/verified`),
  /** The county was asked for its surplus list today; the next request date follows. */
  countyListRequested: (id: string) => api.post(`/surplus/counties/${id}/list-requested`),
  uploadCountyForm: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/surplus/counties/${id}/claim-form`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  countyFormUrl: (id: string) => api.get(`/surplus/counties/${id}/claim-form/url`),
  removeCountyForm: (id: string) => api.post(`/surplus/counties/${id}/claim-form/delete`),

  // ── Documents: the claim's document set ──
  storageStatus: () => api.get('/surplus/storage/status'),
  documents: (id: string) => api.get(`/surplus/${id}/documents`),
  uploadDocument: (id: string, kind: string, file: File, data: { status?: string; note?: string } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (data.status) fd.append('status', data.status);
    if (data.note) fd.append('note', data.note);
    return api.post(`/surplus/${id}/documents/${kind}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  setDocumentStatus: (
    id: string,
    kind: string,
    data: {
      status: string;
      note?: string | null;
      signedAt?: string | null;
      templateKind?: string | null;
      templateVersion?: number | null;
    },
  ) => api.patch(`/surplus/${id}/documents/${kind}`, data),
  /** One of our standard documents rendered from its template, for the print page. */
  documentDraft: (id: string, kind: string) => api.get(`/surplus/${id}/document-draft`, { params: { kind } }),
  // ── Trace attempts: the search log ──
  addTraceAttempt: (
    id: string,
    data: {
      channel: string;
      source?: string | null;
      result: string;
      summary?: string | null;
      cost?: number | null;
      heirId?: string | null;
    },
  ) => api.post(`/surplus/${id}/trace-attempts`, data),
  removeTraceAttempt: (attemptId: string) => api.post(`/surplus/trace-attempts/${attemptId}/delete`),

  // ── Social profiles: the third route when no phone or address is live ──
  socialProfiles: (id: string) => api.get(`/surplus/${id}/social`),
  /** A profile somebody found by hand. Confirmed on arrival. */
  addSocialProfile: (id: string, data: { url: string; heirId?: string | null; displayName?: string | null; evidence?: string | null }) =>
    api.post(`/surplus/${id}/social`, data),
  /** Search the public web for one person's profiles: the claimant, or `heirId`. Paid per check. */
  findSocialProfiles: (id: string, heirId?: string | null) => api.post(`/surplus/${id}/social/find`, { heirId: heirId || null }),
  setSocialProfileStatus: (profileId: string, status: 'candidate' | 'confirmed' | 'rejected') =>
    api.patch(`/surplus/social/${profileId}`, { status }),
  /** A message went out through the profile. Logged as a touch. */
  socialMessaged: (profileId: string, note?: string | null) => api.post(`/surplus/social/${profileId}/messaged`, { note: note || null }),
  removeSocialProfile: (profileId: string) => api.post(`/surplus/social/${profileId}/delete`),
  /** The batch: living claimants with no number, not yet searched. `dryRun` counts and prices them. */
  socialSearch: (body: { leadIds?: string[]; county?: string; limit?: number; dryRun?: boolean }) =>
    api.post('/surplus/social-search', body),
  socialUsage: () => api.get('/surplus/social-usage'),
  /** The notice reader (Claude vision on scanned notices) month to date: reads, dollars, paused. */
  noticeUsage: () => api.get('/surplus/notice-usage'),

  // ── References ──
  references: (county?: string | null) => api.get('/surplus/references', { params: { county: county || undefined } }),
  saveReference: (
    id: string,
    data: { consented?: boolean; story?: string | null; quote?: string | null; amountRecovered?: number | null },
  ) => api.post(`/surplus/${id}/reference`, data),

  // ── Disbursement ──
  expenses: (id: string) => api.get(`/surplus/${id}/expenses`),
  addExpense: (id: string, data: { kind: string; amount: number; incurredAt?: string | null; note?: string | null }) =>
    api.post(`/surplus/${id}/expenses`, data),
  removeExpense: (expenseId: string) => api.post(`/surplus/expenses/${expenseId}/delete`),
  /** The disbursement report: expenses, fee, both shares, the cap check. */
  disbursementReport: (id: string) => api.get(`/surplus/${id}/disbursement-report`),
  /** The mobile notary packet: cover sheet plus the documents for this appointment. */
  notaryPacket: (id: string, includeAll = false) =>
    api.get(`/surplus/${id}/notary-packet`, { params: { includeAll: includeAll ? 'true' : undefined } }),
  documentUrl: (docId: string) => api.get(`/surplus/documents/${docId}/url`),
  removeDocument: (docId: string) => api.post(`/surplus/documents/${docId}/delete`),

  // ── Credibility packet ──
  /** Whether the packet's links are configured, and which are missing. */
  credibilityStatus: () => api.get('/surplus/credibility/status'),
  /** Send the packet by text, email, or both, as Dig Deeper. */
  sendCredibility: (
    id: string,
    body: { channels: ('sms' | 'email')[]; phone?: string | null; email?: string | null },
  ) => api.post(`/surplus/${id}/credibility`, body),
  // A fresh link to a county document whose stored link expires (RealTDM).
  documentLink: (source: string, docId: string, docType?: string | null) =>
    api.get('/surplus/document-link', { params: { source, docId, docType: docType || undefined } }),

  // ── Heirs of a deceased claimant ──
  heirs: (id: string) => api.get(`/surplus/${id}/heirs`),
  /** A number reaches somebody other than the row it sits on: move it, and re-file the thread. */
  reassignNumber: (
    id: string,
    body: {
      number: string;
      to: { claimant: true } | { heirId: string } | { newPerson: { name: string; role?: string | null; relationship?: string | null } };
    },
  ) => api.post(`/surplus/${id}/numbers/reassign`, body),
  /**
   * Read a probate filing and get the heirs back for confirmation. Does not
   * save: whether this case belongs to this claimant is a human judgement.
   */
  readFiling: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/surplus/${id}/heirs/read-filing`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  saveHeirs: (
    id: string,
    body: { heirs: any[]; caseNumber?: string | null; sourceDocument?: string | null },
  ) => api.post(`/surplus/${id}/heirs`, body),
  /** One person added by hand: a missed heir, or somebody who may know where the claimant is. */
  addHeir: (
    id: string,
    body: {
      name: string;
      role?: string | null;
      relationship?: string | null;
      share?: string | null;
      street?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      /** Primary first. A number alone, or with its line type. */
      phones?: (string | { number: string; type?: string | null })[];
      emails?: string[];
      callNotes?: string | null;
    },
  ) => api.post(`/surplus/${id}/heirs/add`, body),
  updateHeir: (heirId: string, body: any) => api.patch(`/surplus/heirs/${heirId}`, body),
  deleteHeir: (heirId: string) => api.post(`/surplus/heirs/${heirId}/delete`),
  /** Saved IDI batches, newest first, and one batch row by row with the relatives it filed. */
  batches: () => api.get('/surplus/batches'),
  batch: (id: string) => api.get(`/surplus/batches/${id}`),
  /** The outreach list: everyone on a batch, a queue (Call now by default) or the claims with a letter due. */
  outreach: (scope: { batch?: string | null; queue?: string | null; letters?: boolean }) =>
    api.get('/surplus/outreach', {
      params: {
        ...(scope.batch ? { batch: scope.batch } : {}),
        ...(scope.queue ? { queue: scope.queue } : {}),
        ...(scope.letters ? { letters: '1' } : {}),
      },
    }),
  /** Mark a person on the outreach list: a call, text or email made outside Dealcore, a note, or done. */
  addTouch: (leadId: string, body: { heirId: string | null; kind: string; note?: string }) =>
    api.post(`/surplus/${leadId}/touches`, body),
  clearDone: (leadId: string, heirId: string | null) =>
    api.delete(`/surplus/${leadId}/touches/done`, { params: heirId ? { heir: heirId } : {} }),
  /** IDI batch skip trace: the upload file for the chosen claimants. */
  idiExport: (leadIds: string[]) => api.post('/surplus/idi/export', { leadIds }),
  /** The print run: every letter due, rendered, claimant first then the relatives. Records nothing. */
  printRun: (county?: string | null, max?: number | null) =>
    api.get('/surplus/print-run', { params: { county: county || undefined, max: max || undefined } }),
  /** The run went out: record every envelope and log the postage on each claim. */
  printRunMailed: (body: {
    items: {
      leadId: string;
      heirId: string | null;
      kind: string;
      version: number | null;
      recipientName: string | null;
      address: string | null;
      mailType: string;
      trackingNumber: string | null;
      letterNumber: number | null;
    }[];
    postage?: Record<string, number | null>;
    mailedAt?: string | null;
    note?: string | null;
  }) => api.post('/surplus/print-run/mailed', body),
  /** The whole Send to IDI queue, inside the trace window and not already waiting on a batch, as one file. */
  idiExportReady: (county?: string | null) => api.post('/surplus/idi/export-ready', { county: county || null }),
  /** Read an IDI results file and match each row to a claimant. Writes nothing. */
  idiImportParse: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/surplus/idi/import/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  /** Apply an IDI results file. assignments: row index to lead id, or null to leave the row out. */
  idiImportExecute: (file: File, assignments: Record<string, string | null>) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('assignments', JSON.stringify(assignments));
    return api.post('/surplus/idi/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importParse: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/surplus/import/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importExecute: (file: File, options?: any) => {
    const formData = new FormData();
    formData.append('file', file);
    if (options) Object.entries(options).forEach(([k, v]) => formData.append(k, String(v)));
    return api.post('/surplus/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Probate API. list() returns rows grouped by contact, not by lead.
export const probateAPI = {
  list: (params?: any) => api.get('/probate', { params }),
  stats: () => api.get('/probate/stats'),
  get: (id: string) => api.get(`/probate/${id}`),
  update: (id: string, data: any) => api.patch(`/probate/${id}`, data),
  updateContact: (contactKey: string, data: any) =>
    api.patch(`/probate/contacts/${encodeURIComponent(contactKey)}`, data),
  bulkDelete: (ids: string[]) => api.post('/probate/bulk-delete', { ids }),
  // Keyed on the heir, not a lead: one heir routinely inherits several
  // parcels, and marking their primary lead dead would leave the rest alive.
  bulkStatus: (contactKeys: string[], status: string) =>
    api.post('/probate/bulk-status', { contactKeys, status }),
  bulkDeleteContacts: (contactKeys: string[]) =>
    api.post('/probate/bulk-delete-contacts', { contactKeys }),
  importParse: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/probate/import/parse', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  importExecute: (file: File, opts: { tier?: number | null; dryRun?: boolean } = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    if (opts.tier != null) formData.append('tier', String(opts.tier));
    if (opts.dryRun) formData.append('dryRun', 'true');
    return api.post('/probate/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Messages API
export const messagesAPI = {
  list: (leadId: string) => api.get(`/leads/${leadId}/messages`),
  draft: (leadId: string, context?: string) =>
    api.post(`/leads/${leadId}/messages/draft`, { context }),
  send: (leadId: string, message: string, userId?: string, from?: string, to?: string) =>
    api.post(`/leads/${leadId}/messages/send`, { message, userId, from, to }),
  fromOptions: (leadId: string, userId?: string) =>
    api.get(`/leads/${leadId}/messages/from-options`, { params: userId ? { userId } : {} }),
  // The seller's own numbers (skip trace attaches up to four) plus the one to preselect
  toOptions: (leadId: string) => api.get(`/leads/${leadId}/messages/to-options`),
  // Send an email (reply or forward) from the logged-in user, via Mailgun
  sendEmail: (
    leadId: string,
    data: {
      userId: string;
      subject?: string;
      body?: string;
      bodyHtml?: string;
      to?: string;
      inReplyToEmailId?: string;
    },
  ) => api.post(`/leads/${leadId}/messages/emails/send`, data),
  rescore: (leadId: string, userId?: string) =>
    api.post(`/leads/${leadId}/messages/rescore`, { userId }),
  simulateReply: (leadId: string, message: string) =>
    api.post(`/leads/${leadId}/messages/simulate-reply`, { message }),
};

// Unified Inbox API (cross-lead message threads)
export type InboxFilter = 'all' | 'unread' | 'starred' | 'recent';
export const inboxAPI = {
  threads: (params: { filter?: InboxFilter; search?: string; page?: number; limit?: number }) =>
    api.get('/inbox/threads', { params }),
  counts: () => api.get('/inbox/counts'),
  markRead: (leadId: string) => api.post(`/inbox/threads/${leadId}/read`),
  star: (leadId: string, starred: boolean) =>
    api.post(`/inbox/threads/${leadId}/star`, { starred }),
  // Voicemails from numbers that matched no lead.
  voicemails: () => api.get('/inbox/voicemails'),
  dismissVoicemail: (id: string) => api.post(`/inbox/voicemails/${id}/dismiss`),
  attachVoicemail: (id: string, leadId: string) =>
    api.post(`/inbox/voicemails/${id}/attach`, { leadId }),
};

// Comps API
export type CompsSource = 'reapi' | 'batchdata' | 'auto';
export const compsAPI = {
  fetch: (leadId: string, forceRefresh?: boolean, source?: CompsSource) => {
    const params = new URLSearchParams();
    if (forceRefresh) params.set('forceRefresh', 'true');
    if (source) params.set('source', source);
    const qs = params.toString();
    return api.post(`/leads/${leadId}/comps${qs ? `?${qs}` : ''}`);
  },
  list: (leadId: string) => api.get(`/leads/${leadId}/comps`),
  toggleComp: (leadId: string, compId: string) =>
    api.post(`/leads/${leadId}/comps/${compId}/toggle`),
  // Phase B: Comp Drill-in modal — fetches REAPI MLSDetail for the
  // comp (cached 24h server-side). Returns normalized event timeline.
  mlsDetail: (leadId: string, compId: string) =>
    api.get(`/leads/${leadId}/comps/${compId}/mls-detail`),
  autoSelect: (leadId: string, minSimilarity: number, maxDistance: number) =>
    api.post(`/leads/${leadId}/comps/auto-select`, { minSimilarity, maxDistance }),
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
  // calculateArv, aiAdjustComps, saveToLead, generateAssessment removed in
  // Build 016. ARV now lives in arvCalculationAPI below.
  aiSummary: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/ai-summary`),
  estimateRepairs: (leadId: string, analysisId: string, data: any) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/estimate-repairs`, data),
  calculateDeal: (leadId: string, analysisId: string, data: any) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/calculate-deal`, data),
  dealIntelligence: (leadId: string, analysisId: string) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/deal-intelligence`),
  applyFilters: (leadId: string, analysisId: string, data: { maxDistance?: number; timeFrameMonths?: number }) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/apply-filters`, data),
  analyzePhotos: (leadId: string, analysisId: string, formData: FormData) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/analyze-photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  analyzeLeadPhotos: (leadId: string, analysisId: string, photoIds: string[]) =>
    api.post(`/leads/${leadId}/comp-analysis/${analysisId}/analyze-lead-photos`, { photoIds }),
};

// AI ARV Calculation API (Build 016)
export const arvCalculationAPI = {
  // Run a fresh ARV calculation. Returns { result } where result is the
  // full AIArvCalculationResult shape. Set forceRefresh: true to bypass
  // the input-hash cache.
  calculate: (
    leadId: string,
    body: {
      mode: 'ARV_RENOVATED' | 'AS_IS';
      forceRefresh?: boolean;
      selectedCompIds?: string[];
    },
  ) => api.post(`/leads/${leadId}/arv-calculation`, body),
  // Latest persisted calculation (the one currently set as lead.arv).
  getLatest: (leadId: string) => api.get(`/leads/${leadId}/arv-calculation`),
  // Calculation history, newest first.
  getHistory: (leadId: string, limit = 20) =>
    api.get(`/leads/${leadId}/arv-calculation/history`, { params: { limit } }),
};

// Phase D: Deal Math (replaces Repairs + Deal Analysis tabs)
export const dealMathAPI = {
  get: (leadId: string) => api.get(`/leads/${leadId}/deal-math`),
  setStrategy: (leadId: string, strategy: string | null) =>
    api.patch(`/leads/${leadId}/deal-math/strategy`, { strategy }),
  setInputs: (leadId: string, strategy: string, patch: Record<string, unknown>) =>
    api.patch(`/leads/${leadId}/deal-math/inputs`, { strategy, patch }),
  setRepairEstimate: (
    leadId: string,
    body: {
      value: number | null;
      method: 'PHOTO_ANALYSIS' | 'QUICK_SQFT' | 'MANUAL_BUILDER' | 'AI_TEXT' | 'MANUAL_OVERRIDE';
      metadata?: Record<string, unknown> | null;
    },
  ) => api.patch(`/leads/${leadId}/deal-math/repair-estimate`, body),
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
  listPhoneNumbers: () => api.get('/settings/phone-numbers'),
  addPhoneNumber: (data: { number: string; label?: string; smsEnabled?: boolean; voiceEnabled?: boolean; isDefault?: boolean }) =>
    api.post('/settings/phone-numbers', data),
  updatePhoneNumber: (id: string, data: Partial<{ label: string; smsEnabled: boolean; voiceEnabled: boolean; isDefault: boolean; active: boolean }>) =>
    api.patch(`/settings/phone-numbers/${id}`, data),
  deletePhoneNumber: (id: string) => api.delete(`/settings/phone-numbers/${id}`),
  getCompliance: () => api.get('/settings/compliance'),
  updateCompliance: (data: {
    optOutEnabled?: boolean;
    optOutText?: string;
    senderIdEnabled?: boolean;
    senderIdText?: string;
    senderIdTextDigDeeper?: string;
    periodicEnabled?: boolean;
    periodicDays?: number;
  }) => api.patch('/settings/compliance', data),
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

// Actions API (Dashboard V2 Action Queue)
export const actionsAPI = {
  queue: (params?: { category?: string | string[]; sort?: 'priority' | 'oldest' | 'newest'; limit?: number }) =>
    api.get('/actions/queue', {
      params: {
        ...params,
        category: Array.isArray(params?.category) ? params!.category.join(',') : params?.category,
      },
    }),
  badges: () => api.get('/actions/badges'),
  markSeen: () => api.post('/actions/seen'),
  dismiss: (actionKey: string) =>
    api.post(`/actions/${encodeURIComponent(actionKey)}/dismiss`),
  snooze: (actionKey: string, until: string) =>
    api.post(`/actions/${encodeURIComponent(actionKey)}/snooze`, { until }),
  complete: (actionKey: string) =>
    api.post(`/actions/${encodeURIComponent(actionKey)}/complete`),
};

// Pipeline API
export const pipelineAPI = {
  get: () => api.get('/pipeline'),
  updateStage: (id: string, stage: string) =>
    api.patch(`/pipeline/leads/${id}/stage`, { stage }),
  bulkUpdateStage: (ids: string[], stage: string) =>
    api.post('/pipeline/leads/bulk-stage', { ids, stage }),
  getInsights: () => api.post('/pipeline/insights'),
};

// Campaigns API (drip)
export const campaignsAPI = {
  list: () => api.get('/campaigns'),
  /** heirId enrolls a person on a surplus case instead of the claimant. */
  enroll: (campaignId: string, leadId: string, toEmail?: string, heirId?: string | null) =>
    api.post(`/campaigns/${campaignId}/enroll/${leadId}`, {
      ...(toEmail ? { toEmail } : {}),
      ...(heirId ? { heirId } : {}),
    }),
  pauseEnrollment: (enrollmentId: string) =>
    api.patch(`/campaigns/enrollments/${enrollmentId}/pause`),
  resumeEnrollment: (enrollmentId: string) =>
    api.patch(`/campaigns/enrollments/${enrollmentId}/resume`),
  removeEnrollment: (enrollmentId: string) =>
    api.delete(`/campaigns/enrollments/${enrollmentId}`),
  leadEnrollments: (leadId: string) =>
    api.get(`/leads/${leadId}/campaigns`),
};

/** What the dialer's summary screen records after a call. */
export interface CallDispositionInput {
  disposition: string;
  notes?: string;
  /** SurplusCallOutcome, on a surplus lead. */
  outcome?: string | null;
  /** SurplusObjection, when one came up. */
  objection?: string | null;
  scriptVersion?: string | null;
  voicemailVersion?: string | null;
  /** ISO datetime. The API turns it into a follow-up task on the lead. */
  followUpAt?: string | null;
  /**
   * Who picked up, when it was not the person the number is filed under. The
   * API moves the number to them and re-files the thread.
   */
  answeredBy?:
    | { claimant: true }
    | { heirId: string }
    | { newPerson: { name: string; role?: string | null; relationship?: string | null } }
    | null;
}

// Calls API
export const callsAPI = {
  initiateAiCall: (leadId: string) =>
    api.post('/calls/ai-initiate', { leadId }),
  // Twilio browser dialer
  twilioToken: () => api.post('/calls/twilio/token'),
  twilioDisposition: (callSid: string, input: CallDispositionInput) =>
    api.post('/calls/twilio/disposition', { callSid, ...input }),
  twilioRecents: (limit = 25) =>
    api.get('/calls/twilio/recents', { params: { limit } }),
  twilioNumbers: () => api.get('/calls/twilio/numbers'),
  // In-call controls. All address the call by the browser leg's CallSid.
  twilioHold: (callSid: string, hold: boolean) =>
    api.post('/calls/twilio/hold', { callSid, hold }),
  twilioBlindTransfer: (callSid: string, to: string) =>
    api.post('/calls/twilio/transfer/blind', { callSid, to }),
  twilioWarmTransfer: (callSid: string, to: string) =>
    api.post('/calls/twilio/transfer/warm', { callSid, to }),
  twilioWarmTransferComplete: (callSid: string) =>
    api.post('/calls/twilio/transfer/warm/complete', { callSid }),
  twilioWarmTransferCancel: (callSid: string) =>
    api.post('/calls/twilio/transfer/warm/cancel', { callSid }),
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
  enrollLeads: (id: string, leadIds: string[]) =>
    api.post(`/campaigns/${id}/enroll`, { leadIds }),
  resyncSchedule: (id: string) => api.post(`/campaigns/${id}/resync-schedule`),
  resumePaused: (id: string) => api.post(`/campaigns/${id}/resume-paused`),
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

// Partners & Deal Sharing API
export const partnersAPI = {
  list: (params?: { search?: string; type?: string; page?: number; limit?: number }) =>
    api.get('/partners', { params }),
  get: (id: string) => api.get(`/partners/${id}`),
  create: (data: { name: string; email: string; company?: string; phone?: string; type?: string; tags?: string[]; notes?: string }) =>
    api.post('/partners', data),
  update: (id: string, data: { name?: string; email?: string; company?: string; phone?: string; type?: string; tags?: string[]; notes?: string; needsTypeReview?: boolean }) =>
    api.patch(`/partners/${id}`, data),
  delete: (id: string) => api.delete(`/partners/${id}`),
  shareDeal: (data: { leadId: string; partnerIds: string[]; channel?: string; personalNote?: string; emailSubject?: string }) =>
    api.post('/partners/share-deal', data),
  getLeadShares: (leadId: string) => api.get(`/leads/${leadId}/shares`),
  getPartnerShares: (partnerId: string) => api.get(`/partners/${partnerId}/shares`),
  resend: (shareId: string) => api.post(`/partners/shares/${shareId}/resend`),
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

// Disposition v2 — plan, costs, final sale, and stage transitions.
export const dispositionAPI = {
  getPlan: (leadId: string) => api.get(`/leads/${leadId}/disposition-plan`),
  upsertPlan: (leadId: string, data: any) => api.post(`/leads/${leadId}/disposition-plan`, data),
  listCosts: (leadId: string) => api.get(`/leads/${leadId}/disposition-costs`),
  createCost: (leadId: string, data: any) => api.post(`/leads/${leadId}/disposition-costs`, data),
  updateCost: (leadId: string, costId: string, data: any) =>
    api.patch(`/leads/${leadId}/disposition-costs/${costId}`, data),
  deleteCost: (leadId: string, costId: string) =>
    api.delete(`/leads/${leadId}/disposition-costs/${costId}`),
  getFinalSale: (leadId: string) => api.get(`/leads/${leadId}/final-sale`),
  upsertFinalSale: (leadId: string, data: any) => api.post(`/leads/${leadId}/final-sale`, data),
  markAcquired: (leadId: string) => api.post(`/leads/${leadId}/mark-acquired`),
  markSold: (leadId: string) => api.post(`/leads/${leadId}/mark-sold`),
};

// PropertyLookups API (ad-hoc Comps & Analysis without a Lead)
export const propertyLookupsAPI = {
  list: (params?: { archived?: boolean; q?: string }) =>
    api.get('/property-lookups', { params }),
  create: (data: {
    address: string;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    propertyType?: string | null;
    bedrooms?: number | null;
    bathrooms?: number | null;
    sqft?: number | null;
    yearBuilt?: number | null;
    lotSize?: number | null;
    notes?: string | null;
  }) => api.post('/property-lookups', data),
  get: (id: string) => api.get(`/property-lookups/${id}`),
  update: (id: string, data: any) => api.patch(`/property-lookups/${id}`, data),
  remove: (id: string) => api.delete(`/property-lookups/${id}`),
  archive: (id: string) => api.post(`/property-lookups/${id}/archive`),
  unarchive: (id: string) => api.post(`/property-lookups/${id}/unarchive`),
  analyze: (
    id: string,
    body?: {
      preferSource?: 'reapi' | 'batchdata';
      forceRefresh?: boolean;
      mode?: string;
      maxDistance?: number;
      timeFrameMonths?: number;
      propertyType?: string;
    },
  ) => api.post(`/property-lookups/${id}/analyze`, body || {}),
  fetchComps: (
    id: string,
    body?: { preferSource?: 'reapi' | 'batchdata'; forceRefresh?: boolean },
  ) => api.post(`/property-lookups/${id}/fetch-comps`, body || {}),

  // Mirrored comp-analysis routes — same shape as compAnalysisAPI but scoped
  // to a PropertyLookup parent.
  listAnalyses: (id: string) => api.get(`/property-lookups/${id}/comp-analysis`),
  getAnalysis: (id: string, analysisId: string) =>
    api.get(`/property-lookups/${id}/comp-analysis/${analysisId}`),
  createAnalysis: (id: string, body?: any) =>
    api.post(`/property-lookups/${id}/comp-analysis`, body || {}),
  updateAnalysis: (id: string, analysisId: string, data: any) =>
    api.patch(`/property-lookups/${id}/comp-analysis/${analysisId}`, data),
  toggleComp: (id: string, analysisId: string, compId: string) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/comps/${compId}/toggle`),
  selectAll: (id: string, analysisId: string, selected: boolean, source?: string) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/comps/select-all`, {
      selected,
      source,
    }),
  calculateAdjustments: (id: string, analysisId: string, config?: any) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/calculate-adjustments`, {
      config,
    }),
  aiSummary: (id: string, analysisId: string) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/ai-summary`),
  estimateRepairs: (id: string, analysisId: string, data: any) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/estimate-repairs`, data),
  calculateDeal: (id: string, analysisId: string, data: any) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/calculate-deal`, data),
  dealIntelligence: (id: string, analysisId: string) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/deal-intelligence`),
  applyFilters: (
    id: string,
    analysisId: string,
    data: { maxDistance?: number; timeFrameMonths?: number },
  ) => api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/apply-filters`, data),
  analyzePhotos: (id: string, analysisId: string, formData: FormData) =>
    api.post(`/property-lookups/${id}/comp-analysis/${analysisId}/analyze-photos`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// Deals API (portfolio-level view of late-stage leads)
export const dealsAPI = {
  summary: (params?: { realizedFrom?: string; realizedTo?: string }) =>
    api.get('/deals/summary', { params }),
  list: (params?: Record<string, any>) => api.get('/deals', { params }),
  exportCsv: (filters: Record<string, any>) =>
    api.post('/deals/export-csv', filters, { responseType: 'blob' }),
};
