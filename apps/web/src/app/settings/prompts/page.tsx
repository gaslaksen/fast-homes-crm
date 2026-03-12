'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { promptsAPI } from '@/lib/api';

interface AiPrompt {
  id: string;
  name: string;
  scenario: string;
  contextRules: any;
  systemPrompt: string;
  exampleMessages: any[] | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const LEAD_STATUSES = [
  'NEW',
  'ATTEMPTING_CONTACT',
  'QUALIFIED',
  'OFFER_SENT',
  'UNDER_CONTRACT',
  'CLOSING',
  'CLOSED_WON',
  'CLOSED_LOST',
];

const CAMP_FIELDS = ['askingPrice', 'timeline', 'conditionLevel', 'ownershipStatus'];

const SCENARIO_OPTIONS = [
  'initial_contact',
  'motivation_discovery',
  'objection_handling',
  'follow_up',
  'rbp_explanation',
  'custom',
];

function scenarioBadgeColor(scenario: string): string {
  const colors: Record<string, string> = {
    initial_contact: 'bg-blue-100 text-blue-800',
    motivation_discovery: 'bg-purple-100 text-purple-800',
    objection_handling: 'bg-red-100 text-red-800',
    follow_up: 'bg-yellow-100 text-yellow-800',
    rbp_explanation: 'bg-green-100 text-green-800',
  };
  return colors[scenario] || 'bg-gray-100 text-gray-800';
}

export default function PromptsPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  // Edit form state
  const [formName, setFormName] = useState('');
  const [formScenario, setFormScenario] = useState('');
  const [formPriority, setFormPriority] = useState(0);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSystemPrompt, setFormSystemPrompt] = useState('');
  const [formLeadStatuses, setFormLeadStatuses] = useState<string[]>([]);
  const [formMinMessages, setFormMinMessages] = useState<string>('');
  const [formMaxMessages, setFormMaxMessages] = useState<string>('');
  const [formRequiresFields, setFormRequiresFields] = useState<string[]>([]);
  const [formObjectionKeywords, setFormObjectionKeywords] = useState('');
  const [formExampleMessages, setFormExampleMessages] = useState('');

  useEffect(() => {
    loadPrompts();
  }, []);

  const loadPrompts = async () => {
    try {
      const res = await promptsAPI.list();
      setPrompts(res.data);
    } catch (error) {
      console.error('Failed to load prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const populateForm = (prompt: AiPrompt) => {
    setFormName(prompt.name);
    setFormScenario(prompt.scenario);
    setFormPriority(prompt.priority);
    setFormIsActive(prompt.isActive);
    setFormSystemPrompt(prompt.systemPrompt);

    const rules = prompt.contextRules || {};
    setFormLeadStatuses(rules.leadStatuses || []);
    setFormMinMessages(rules.minMessages != null ? String(rules.minMessages) : '');
    setFormMaxMessages(rules.maxMessages != null ? String(rules.maxMessages) : '');
    setFormRequiresFields(rules.requiresFields || []);
    setFormObjectionKeywords(
      (rules.objectionKeywords || []).join('\n'),
    );
    setFormExampleMessages(
      prompt.exampleMessages ? JSON.stringify(prompt.exampleMessages, null, 2) : '',
    );
  };

  const resetForm = () => {
    setFormName('');
    setFormScenario('');
    setFormPriority(0);
    setFormIsActive(true);
    setFormSystemPrompt('');
    setFormLeadStatuses([]);
    setFormMinMessages('');
    setFormMaxMessages('');
    setFormRequiresFields([]);
    setFormObjectionKeywords('');
    setFormExampleMessages('');
  };

  const buildPayload = () => {
    const contextRules: any = {};
    if (formLeadStatuses.length > 0) contextRules.leadStatuses = formLeadStatuses;
    if (formMinMessages !== '') contextRules.minMessages = parseInt(formMinMessages);
    if (formMaxMessages !== '') contextRules.maxMessages = parseInt(formMaxMessages);
    if (formRequiresFields.length > 0) contextRules.requiresFields = formRequiresFields;
    const keywords = formObjectionKeywords.split('\n').map((k) => k.trim()).filter(Boolean);
    if (keywords.length > 0) contextRules.objectionKeywords = keywords;

    let exampleMessages = null;
    if (formExampleMessages.trim()) {
      try {
        exampleMessages = JSON.parse(formExampleMessages);
      } catch {
        alert('Example messages must be valid JSON');
        return null;
      }
    }

    return {
      name: formName,
      scenario: formScenario,
      priority: formPriority,
      isActive: formIsActive,
      systemPrompt: formSystemPrompt,
      contextRules,
      exampleMessages,
    };
  };

  const handleCreate = async () => {
    const payload = buildPayload();
    if (!payload) return;
    if (!payload.name || !payload.scenario || !payload.systemPrompt) {
      alert('Name, scenario, and system prompt are required');
      return;
    }

    setSaving(true);
    try {
      await promptsAPI.create(payload);
      setCreating(false);
      resetForm();
      await loadPrompts();
    } catch (error: any) {
      alert('Failed to create prompt: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    const payload = buildPayload();
    if (!payload) return;

    setSaving(true);
    try {
      await promptsAPI.update(id, payload);
      setEditingId(null);
      resetForm();
      await loadPrompts();
    } catch (error: any) {
      alert('Failed to update prompt: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete prompt "${name}"? This cannot be undone.`)) return;
    try {
      await promptsAPI.delete(id);
      await loadPrompts();
    } catch (error: any) {
      alert('Failed to delete: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleToggleActive = async (prompt: AiPrompt) => {
    try {
      await promptsAPI.update(prompt.id, { isActive: !prompt.isActive });
      await loadPrompts();
    } catch (error: any) {
      alert('Failed to toggle: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await promptsAPI.test(id);
      setTestResult(res.data);
    } catch (error: any) {
      setTestResult({ error: error.response?.data?.message || error.message });
    } finally {
      setTestingId(null);
    }
  };

  const renderForm = (onSave: () => void, onCancel: () => void) => (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            className="input w-full"
            placeholder="e.g. Initial Contact"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Scenario</label>
          <select
            value={SCENARIO_OPTIONS.includes(formScenario) ? formScenario : 'custom'}
            onChange={(e) => setFormScenario(e.target.value)}
            className="input w-full"
          >
            {SCENARIO_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          {!SCENARIO_OPTIONS.includes(formScenario) && formScenario !== 'custom' && (
            <input
              type="text"
              value={formScenario}
              onChange={(e) => setFormScenario(e.target.value)}
              className="input w-full mt-1"
              placeholder="Custom scenario key"
            />
          )}
          {formScenario === 'custom' && (
            <input
              type="text"
              value=""
              onChange={(e) => setFormScenario(e.target.value)}
              className="input w-full mt-1"
              placeholder="Enter custom scenario key"
            />
          )}
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
            <input
              type="number"
              min={0}
              value={formPriority}
              onChange={(e) => setFormPriority(Number(e.target.value))}
              className="input w-full"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                type="button"
                onClick={() => setFormIsActive(!formIsActive)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formIsActive ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formIsActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700">Active</span>
            </label>
          </div>
        </div>
      </div>

      {/* Context Rules */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Context Rules</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lead Statuses</label>
            <div className="flex flex-wrap gap-1">
              {LEAD_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() =>
                    setFormLeadStatuses((prev) =>
                      prev.includes(status)
                        ? prev.filter((s) => s !== status)
                        : [...prev, status],
                    )
                  }
                  className={`text-xs px-2 py-1 rounded border ${
                    formLeadStatuses.includes(status)
                      ? 'bg-primary-100 border-primary-300 text-primary-700'
                      : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >
                  {status.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Required Fields (must be missing on lead)
            </label>
            <div className="flex flex-wrap gap-1">
              {CAMP_FIELDS.map((field) => (
                <button
                  key={field}
                  type="button"
                  onClick={() =>
                    setFormRequiresFields((prev) =>
                      prev.includes(field)
                        ? prev.filter((f) => f !== field)
                        : [...prev, field],
                    )
                  }
                  className={`text-xs px-2 py-1 rounded border ${
                    formRequiresFields.includes(field)
                      ? 'bg-purple-100 border-purple-300 text-purple-700'
                      : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >
                  {field}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Min Messages</label>
              <input
                type="number"
                min={0}
                value={formMinMessages}
                onChange={(e) => setFormMinMessages(e.target.value)}
                className="input w-full text-sm"
                placeholder="Any"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Messages</label>
              <input
                type="number"
                min={0}
                value={formMaxMessages}
                onChange={(e) => setFormMaxMessages(e.target.value)}
                className="input w-full text-sm"
                placeholder="Any"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Objection Keywords (one per line)
            </label>
            <textarea
              value={formObjectionKeywords}
              onChange={(e) => setFormObjectionKeywords(e.target.value)}
              rows={3}
              className="input w-full text-sm"
              placeholder={"think about it\ntalk to spouse\ntoo low"}
            />
          </div>
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
        <textarea
          value={formSystemPrompt}
          onChange={(e) => setFormSystemPrompt(e.target.value)}
          rows={12}
          className="input w-full font-mono text-sm"
          placeholder="Enter the system prompt that will be sent to the AI..."
        />
      </div>

      {/* Example Messages */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Example Messages (JSON, optional)
        </label>
        <textarea
          value={formExampleMessages}
          onChange={(e) => setFormExampleMessages(e.target.value)}
          rows={4}
          className="input w-full font-mono text-sm"
          placeholder={'[\n  { "role": "user", "content": "..." },\n  { "role": "assistant", "content": "..." }\n]'}
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="btn bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Fast Homes CRM</h1>
            <nav className="flex gap-4">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <Link href="/leads" className="text-gray-600 hover:text-gray-900">
                Leads
              </Link>
              <Link href="/settings" className="text-primary-600 font-medium">
                Settings
              </Link>
              <button
                onClick={() => {
                  localStorage.removeItem('auth_token');
                  router.push('/login');
                }}
                className="text-gray-600 hover:text-gray-900"
              >
                Logout
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/settings" className="text-sm text-primary-600 hover:text-primary-800">
              &larr; Back to Settings
            </Link>
            <h2 className="text-xl font-bold text-gray-900 mt-1">AI Prompt Templates</h2>
            <p className="text-sm text-gray-600 mt-1">
              Configure how AI generates messages for different lead scenarios.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => {
                resetForm();
                setCreating(true);
                setEditingId(null);
              }}
              className="btn btn-primary"
            >
              + New Prompt
            </button>
          )}
        </div>

        {/* Create Form */}
        {creating && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Create New Prompt</h3>
            {renderForm(handleCreate, () => {
              setCreating(false);
              resetForm();
            })}
          </div>
        )}

        {/* Prompt List */}
        <div className="space-y-4">
          {prompts.map((prompt) => (
            <div key={prompt.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-semibold text-gray-900">{prompt.name}</h3>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${scenarioBadgeColor(
                        prompt.scenario,
                      )}`}
                    >
                      {prompt.scenario.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-gray-500">Priority: {prompt.priority}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        prompt.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {prompt.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {editingId !== prompt.id && (
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                      {prompt.systemPrompt.substring(0, 200)}
                      {prompt.systemPrompt.length > 200 ? '...' : ''}
                    </p>
                  )}
                </div>

                {editingId !== prompt.id && (
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(prompt)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        prompt.isActive ? 'bg-primary-600' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          prompt.isActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => handleTest(prompt.id)}
                      disabled={testingId === prompt.id}
                      className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {testingId === prompt.id ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(prompt.id);
                        setCreating(false);
                        populateForm(prompt);
                      }}
                      className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(prompt.id, prompt.name)}
                      className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {/* Edit Form */}
              {editingId === prompt.id &&
                renderForm(
                  () => handleUpdate(prompt.id),
                  () => {
                    setEditingId(null);
                    resetForm();
                  },
                )}

              {/* Test Result */}
              {testResult && testResult.promptName === prompt.name && (
                <div className="mt-4 border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Test Results</h4>
                  {testResult.error ? (
                    <p className="text-sm text-red-600">{testResult.error}</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {['direct', 'friendly', 'professional'].map((tone) => (
                        <div key={tone} className="bg-gray-50 rounded p-3">
                          <span className="text-xs font-semibold text-gray-500 uppercase">
                            {tone}
                          </span>
                          <p className="text-sm text-gray-800 mt-1">
                            {testResult.drafts?.[tone] || 'No draft generated'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {prompts.length === 0 && !creating && (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No prompt templates yet</p>
              <p className="text-sm mt-1">Create your first prompt template to get started.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
