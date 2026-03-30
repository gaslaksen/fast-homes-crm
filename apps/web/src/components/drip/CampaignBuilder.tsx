'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { campaignAPI } from '@/lib/api';

interface Step {
  id?: string;
  stepOrder: number;
  channel: 'TEXT' | 'EMAIL';
  delayDays: number;
  delayHours: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  subject: string;
  body: string;
  isActive: boolean;
}

interface CampaignData {
  id?: string;
  name: string;
  description: string;
  triggerDays: number;
  isActive: boolean;
  steps: Step[];
}

interface CampaignBuilderProps {
  initial?: CampaignData;
  onSave?: (data: CampaignData) => void;
}

const MERGE_FIELDS = [
  { label: '{{firstName}}', desc: 'Seller first name' },
  { label: '{{propertyAddress}}', desc: 'Property address' },
  { label: '{{city}}', desc: 'City' },
  { label: '{{arvEstimate}}', desc: 'ARV estimate' },
  { label: '{{offerAmount}}', desc: 'Offer amount' },
];

const SAMPLE_DATA: Record<string, string> = {
  '{{firstName}}': 'John',
  '{{lastName}}': 'Smith',
  '{{propertyAddress}}': '123 Oak St',
  '{{city}}': 'Charlotte',
  '{{state}}': 'NC',
  '{{offerAmount}}': '$185,000',
  '{{arvEstimate}}': '$265,000',
  '{{companyName}}': 'Fast Homes',
  '{{senderName}}': 'Fast Homes Team',
};

function renderPreview(body: string): string {
  let result = body;
  for (const [field, value] of Object.entries(SAMPLE_DATA)) {
    result = result.replace(new RegExp(field.replace(/[{}]/g, '\\$&'), 'g'), value);
  }
  return result;
}

function makeBlankStep(order: number): Step {
  return {
    stepOrder: order,
    channel: 'TEXT',
    delayDays: order === 1 ? 0 : 7,
    delayHours: 0,
    sendWindowStart: '09:00',
    sendWindowEnd: '18:00',
    subject: '',
    body: '',
    isActive: true,
  };
}

// ─── Step Editor ──────────────────────────────────────────────────────────────

function StepEditor({
  step,
  onChange,
  onClose,
}: {
  step: Step;
  onChange: (s: Step) => void;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTone, setAiTone] = useState('Friendly');
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<{ subject?: string; body: string; reasoning: string } | null>(null);

  const isSms = step.channel === 'TEXT';
  const charCount = step.body.length;
  const charWarning = isSms && charCount > 154;

  function insertMerge(field: string) {
    const el = bodyRef.current;
    if (!el) {
      onChange({ ...step, body: step.body + field });
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newBody = step.body.slice(0, start) + field + step.body.slice(end);
    onChange({ ...step, body: newBody });
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + field.length, start + field.length);
    }, 0);
  }

  async function handleAiSuggest() {
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await campaignAPI.aiSuggest({
        channel: step.channel,
        tone: aiTone,
        instructions: aiInstructions || undefined,
        stepNumber: step.stepOrder,
      });
      setAiResult(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  }

  function applyAiResult() {
    if (!aiResult) return;
    onChange({
      ...step,
      body: aiResult.body,
      subject: aiResult.subject || step.subject,
    });
    setAiOpen(false);
    setAiResult(null);
  }

  return (
    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mt-2 space-y-4">
      {/* Channel toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Channel:</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          {(['TEXT', 'EMAIL'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => onChange({ ...step, channel: ch })}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                step.channel === ch
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {ch === 'TEXT' ? '📱 SMS' : '✉️ Email'}
            </button>
          ))}
        </div>
      </div>

      {/* Delay */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Send after:</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            value={step.delayDays}
            onChange={(e) => onChange({ ...step, delayDays: parseInt(e.target.value) || 0 })}
            className="w-16 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-sm text-center dark:bg-gray-800 dark:text-gray-100"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">days</span>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={23}
            value={step.delayHours}
            onChange={(e) => onChange({ ...step, delayHours: parseInt(e.target.value) || 0 })}
            className="w-16 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-sm text-center dark:bg-gray-800 dark:text-gray-100"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">hours</span>
        </div>
      </div>

      {/* Send window */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Send window:</span>
        <input
          type="time"
          value={step.sendWindowStart}
          onChange={(e) => onChange({ ...step, sendWindowStart: e.target.value })}
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-sm dark:bg-gray-800 dark:text-gray-100"
        />
        <span className="text-sm text-gray-500 dark:text-gray-400">to</span>
        <input
          type="time"
          value={step.sendWindowEnd}
          onChange={(e) => onChange({ ...step, sendWindowEnd: e.target.value })}
          className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-sm dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {/* Subject (email only) */}
      {!isSms && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
          <input
            type="text"
            value={step.subject}
            onChange={(e) => onChange({ ...step, subject: e.target.value })}
            placeholder="Email subject line..."
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      )}

      {/* Merge field buttons */}
      <div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Insert merge field:</div>
        <div className="flex flex-wrap gap-1.5">
          {MERGE_FIELDS.map((f) => (
            <button
              key={f.label}
              onClick={() => insertMerge(f.label)}
              title={f.desc}
              className="text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Message body</label>
          <span className={`text-xs ${charWarning ? 'text-red-600 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
            {charCount} chars {isSms && '/ 160'}
          </span>
        </div>
        <textarea
          ref={bodyRef}
          value={step.body}
          onChange={(e) => onChange({ ...step, body: e.target.value })}
          rows={isSms ? 3 : 6}
          placeholder={isSms ? 'Your SMS message... (keep under 160 chars)' : 'Your email body...'}
          className={`w-full border rounded-lg px-3 py-2 text-sm resize-y dark:bg-gray-800 dark:text-gray-100 ${
            charWarning ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
          }`}
        />
      </div>

      {/* Live preview */}
      {step.body && (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Preview (sample data):
          </div>
          {!isSms && step.subject && (
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Subject: {renderPreview(step.subject)}
            </div>
          )}
          <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            {renderPreview(step.body)}
          </div>
        </div>
      )}

      {/* AI Suggest */}
      <div>
        <button
          onClick={() => setAiOpen((o) => !o)}
          className="text-sm flex items-center gap-1.5 text-purple-700 dark:text-purple-400 hover:text-purple-900 font-medium"
        >
          ✨ AI Suggest {aiOpen ? '▲' : '▼'}
        </button>

        {aiOpen && (
          <div className="mt-3 bg-white dark:bg-gray-900 border border-purple-100 dark:border-purple-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">Tone:</span>
              {['Friendly', 'Professional', 'Urgent', 'Empathetic'].map((t) => (
                <button
                  key={t}
                  onClick={() => setAiTone(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    aiTone === t
                      ? 'bg-purple-600 text-white border-purple-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-purple-300 dark:hover:border-purple-800'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder="Optional: extra instructions for AI (e.g. 'mention we pay closing costs')"
              rows={2}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100"
            />
            <button
              onClick={handleAiSuggest}
              disabled={aiLoading}
              className="w-full py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {aiLoading ? 'Generating...' : '✨ Generate'}
            </button>

            {aiResult && (
              <div className="bg-purple-50 dark:bg-purple-950 rounded-lg p-3 space-y-2">
                {aiResult.subject && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">
                    Subject: {aiResult.subject}
                  </div>
                )}
                <div className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{aiResult.body}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 italic">{aiResult.reasoning}</div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={applyAiResult}
                    className="flex-1 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    Use This
                  </button>
                  <button
                    onClick={handleAiSuggest}
                    className="flex-1 py-1.5 bg-white dark:bg-gray-900 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400 text-xs font-medium rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950 transition-colors"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── AI Sequence Generator Modal ──────────────────────────────────────────────

function AiSequenceModal({
  onClose,
  onAccept,
}: {
  onClose: () => void;
  onAccept: (steps: Step[]) => void;
}) {
  const [numSteps, setNumSteps] = useState(5);
  const [channelMix, setChannelMix] = useState<'ALL_SMS' | 'ALL_EMAIL' | 'MIXED'>('MIXED');
  const [tone, setTone] = useState('Friendly');
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any[] | null>(null);

  async function handleGenerate() {
    if (!goal.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await campaignAPI.aiGenerateSequence({
        numSteps,
        channelMix,
        tone,
        goal,
      });
      setResult(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleAccept() {
    if (!result) return;
    const steps: Step[] = result.map((s: any, i: number) => ({
      stepOrder: i + 1,
      channel: s.channel || 'TEXT',
      delayDays: s.delayDays ?? (i === 0 ? 0 : 7),
      delayHours: s.delayHours ?? 0,
      sendWindowStart: '09:00',
      sendWindowEnd: '18:00',
      subject: s.subject || '',
      body: s.body || '',
      isActive: true,
    }));
    onAccept(steps);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">✨ Generate Full Sequence with AI</h2>
            <button
              onClick={onClose}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 text-xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            {/* Num steps */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Number of steps: {numSteps}
              </label>
              <input
                type="range"
                min={3}
                max={10}
                value={numSteps}
                onChange={(e) => setNumSteps(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                <span>3</span><span>10</span>
              </div>
            </div>

            {/* Channel mix */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Channel mix</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: 'ALL_SMS', label: '📱 All SMS' },
                  { value: 'ALL_EMAIL', label: '✉️ All Email' },
                  { value: 'MIXED', label: '🔀 Mixed' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setChannelMix(value as any)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      channelMix === value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tone */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tone</label>
              <div className="flex gap-2 flex-wrap">
                {['Friendly', 'Professional', 'Urgent', 'Empathetic'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      tone === t
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-purple-300 dark:hover:border-purple-800'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Goal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Campaign goal *
              </label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Re-engage leads who went cold 30+ days ago and get them to agree to a call or accept an offer"
                rows={3}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !goal.trim()}
              className="w-full py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Generating sequence...' : '✨ Generate Sequence'}
            </button>

            {/* Results */}
            {result && (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Generated {result.length} steps — preview:
                </div>
                {result.map((s: any, i: number) => (
                  <div key={i} className="bg-gray-50 dark:bg-gray-950 rounded-xl p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-500 dark:text-gray-400">Step {i + 1}</span>
                      <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                        {s.channel === 'TEXT' ? '📱 SMS' : '✉️ Email'}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {s.delayDays === 0 ? 'Immediately' : `After ${s.delayDays}d`}
                      </span>
                    </div>
                    {s.subject && (
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Subject: {s.subject}</div>
                    )}
                    <div className="text-sm text-gray-800 dark:text-gray-200 line-clamp-3">{s.body}</div>
                    {s.reasoning && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 italic">{s.reasoning}</div>
                    )}
                  </div>
                ))}
                <button
                  onClick={handleAccept}
                  className="w-full py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
                >
                  ✅ Accept All & Populate Builder
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main CampaignBuilder ─────────────────────────────────────────────────────

export default function CampaignBuilder({ initial, onSave }: CampaignBuilderProps) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignData>(
    initial || {
      name: 'New Campaign',
      description: '',
      triggerDays: 15,
      isActive: true,
      steps: [],
    },
  );
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [nameEditing, setNameEditing] = useState(!initial);

  const updateStep = useCallback((idx: number, updated: Step) => {
    setCampaign((c) => {
      const steps = [...c.steps];
      steps[idx] = updated;
      return { ...c, steps };
    });
  }, []);

  function addStep(afterIdx?: number) {
    const order =
      afterIdx !== undefined
        ? campaign.steps[afterIdx].stepOrder + 1
        : (campaign.steps[campaign.steps.length - 1]?.stepOrder || 0) + 1;

    const newStep = makeBlankStep(order);
    const steps = [...campaign.steps];

    if (afterIdx !== undefined) {
      steps.splice(afterIdx + 1, 0, newStep);
      // Re-number
      steps.forEach((s, i) => { s.stepOrder = i + 1; });
    } else {
      steps.push(newStep);
    }

    setCampaign((c) => ({ ...c, steps }));
    setEditingStepIdx(afterIdx !== undefined ? afterIdx + 1 : steps.length - 1);
  }

  function deleteStep(idx: number) {
    const steps = campaign.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepOrder: i + 1 }));
    setCampaign((c) => ({ ...c, steps }));
    if (editingStepIdx === idx) setEditingStepIdx(null);
  }

  function toggleStepActive(idx: number) {
    updateStep(idx, { ...campaign.steps[idx], isActive: !campaign.steps[idx].isActive });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...campaign,
        steps: campaign.steps.map((s) => ({
          ...s,
          subject: s.channel === 'EMAIL' ? s.subject : undefined,
        })),
      };

      if (campaign.id) {
        await campaignAPI.update(campaign.id, payload);
      } else {
        await campaignAPI.create(payload);
      }

      router.push('/drip-campaigns');
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save campaign. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function applyAiSequence(steps: Step[]) {
    setCampaign((c) => ({ ...c, steps }));
  }

  return (
    <div className="max-w-3xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex-1 min-w-0">
          {nameEditing ? (
            <input
              type="text"
              value={campaign.name}
              onChange={(e) => setCampaign((c) => ({ ...c, name: e.target.value }))}
              onBlur={() => setNameEditing(false)}
              autoFocus
              className="text-2xl font-bold text-gray-900 dark:text-gray-100 border-b-2 border-blue-400 bg-transparent w-full outline-none pb-1"
            />
          ) : (
            <button
              onClick={() => setNameEditing(true)}
              className="text-2xl font-bold text-gray-900 dark:text-gray-100 hover:text-blue-600 transition-colors text-left"
            >
              {campaign.name || 'Untitled Campaign'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowAiModal(true)}
            className="px-3 py-2 text-sm font-medium bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
          >
            ✨ AI Sequence
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Campaign'}
          </button>
        </div>
      </div>

      {/* Description + trigger */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <textarea
            value={campaign.description}
            onChange={(e) => setCampaign((c) => ({ ...c, description: e.target.value }))}
            placeholder="What is this campaign for?"
            rows={2}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-700 dark:text-gray-300">Enroll leads with no contact for</span>
          <input
            type="number"
            min={1}
            value={campaign.triggerDays}
            onChange={(e) => setCampaign((c) => ({ ...c, triggerDays: parseInt(e.target.value) || 15 }))}
            className="w-20 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-sm dark:bg-gray-800 dark:text-gray-100 text-center"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">days</span>
        </div>
      </div>

      {/* Steps timeline */}
      <div className="space-y-3">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Campaign steps ({campaign.steps.length})
        </div>

        {campaign.steps.length === 0 && (
          <div className="text-center py-10 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-2">📋</div>
            <div className="text-sm">No steps yet. Add your first step below.</div>
          </div>
        )}

        {campaign.steps.map((step, idx) => {
          const isEditing = editingStepIdx === idx;
          const delayLabel =
            step.delayDays === 0 && step.delayHours === 0
              ? 'Immediately'
              : `After ${step.delayDays}d ${step.delayHours > 0 ? step.delayHours + 'h' : ''}`.trim();

          return (
            <div key={idx}>
              {/* Add step button between steps */}
              {idx > 0 && (
                <div className="flex justify-center my-1">
                  <button
                    onClick={() => addStep(idx - 1)}
                    className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full border border-dashed border-blue-200 dark:border-blue-800 hover:border-blue-400 transition-colors"
                  >
                    + Add step here
                  </button>
                </div>
              )}

              <div
                className={`bg-white dark:bg-gray-900 rounded-xl border transition-colors ${
                  isEditing ? 'border-blue-400 shadow-sm' : 'border-gray-200 dark:border-gray-700'
                } ${!step.isActive ? 'opacity-60' : ''}`}
              >
                <div className="p-4 flex items-center gap-3">
                  {/* Step badge */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm font-bold flex items-center justify-center">
                    {step.stepOrder}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {step.channel === 'TEXT' ? '📱 SMS' : '✉️ Email'}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{delayLabel}</span>
                      {step.channel === 'EMAIL' && step.subject && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                          "{step.subject}"
                        </span>
                      )}
                    </div>
                    {step.body && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {step.body.slice(0, 80)}{step.body.length > 80 ? '…' : ''}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleStepActive(idx)}
                      title={step.isActive ? 'Disable step' : 'Enable step'}
                      className={`text-xs px-2 py-1 rounded-md transition-colors ${
                        step.isActive
                          ? 'text-green-600 bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900/30'
                          : 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-950 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {step.isActive ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => setEditingStepIdx(isEditing ? null : idx)}
                      className="text-xs px-2 py-1 text-blue-600 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-md transition-colors"
                    >
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                    <button
                      onClick={() => deleteStep(idx)}
                      className="text-xs px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="px-4 pb-4">
                    <StepEditor
                      step={step}
                      onChange={(updated) => updateStep(idx, updated)}
                      onClose={() => setEditingStepIdx(null)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add step button */}
        <button
          onClick={() => addStep()}
          className="w-full py-3 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-800 hover:text-blue-600 transition-colors"
        >
          + Add Step
        </button>
      </div>

      {/* AI Sequence Modal */}
      {showAiModal && (
        <AiSequenceModal
          onClose={() => setShowAiModal(false)}
          onAccept={applyAiSequence}
        />
      )}
    </div>
  );
}
