'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { leadsAPI } from '@/lib/api';
import AppShell from '@/components/AppShell';

type Step = 'upload' | 'mapping' | 'importing' | 'results';

interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  type: string;
}

export default function ImportLeadsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse results
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<any[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [availableFields, setAvailableFields] = useState<FieldDef[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Import options
  const [source, setSource] = useState('OTHER');
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  // Results
  const [results, setResults] = useState<{
    created: number;
    skipped: number;
    errors: { row: number; reason: string }[];
  } | null>(null);
  const [importing, setImporting] = useState(false);

  const handleFileDrop = useCallback((files: FileList | null) => {
    setDragOver(false);
    if (!files?.length) return;
    const f = files[0];
    if (!f.name.match(/\.(csv|xlsx|xls)$/i)) {
      setError('Please upload a CSV or Excel file');
      return;
    }
    setFile(f);
    setError(null);
  }, []);

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const { data } = await leadsAPI.importParse(file);
      setHeaders(data.headers);
      setSampleRows(data.sampleRows);
      setTotalRows(data.totalRows);
      setAvailableFields(data.availableFields);
      setMapping(data.detectedMapping || {});
      setStep('mapping');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to parse file');
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    setStep('importing');
    try {
      const { data } = await leadsAPI.importExecute(file, mapping, { source, skipDuplicates });
      setResults(data);
      setStep('results');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Import failed');
      setStep('mapping');
    } finally {
      setImporting(false);
    }
  };

  const updateMapping = (sourceHeader: string, targetField: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (targetField === '_skip' || !targetField) {
        delete next[sourceHeader];
      } else {
        next[sourceHeader] = targetField;
      }
      return next;
    });
  };

  // Which required fields are unmapped
  const requiredFields = availableFields.filter((f) => f.required);
  const mappedTargets = new Set(Object.values(mapping));
  const unmappedRequired = requiredFields.filter((f) => !mappedTargets.has(f.key));

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/leads" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-sm">
            &larr; Back to Leads
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Import Leads</h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6 text-sm">
          {[
            { id: 'upload', label: '1. Upload File' },
            { id: 'mapping', label: '2. Map Fields' },
            { id: 'results', label: '3. Results' },
          ].map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-gray-300 dark:bg-gray-600" />}
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  step === s.id || (step === 'importing' && s.id === 'results')
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : ['mapping', 'importing', 'results'].indexOf(step) > ['upload', 'mapping', 'results'].indexOf(s.id)
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); handleFileDrop(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => handleFileDrop(e.target.files)}
              />
              {file ? (
                <div>
                  <div className="text-3xl mb-2">&#128196;</div>
                  <p className="text-lg font-medium text-gray-900 dark:text-gray-100">{file.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {(file.size / 1024).toFixed(0)} KB &middot; Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3 text-gray-400 dark:text-gray-500">&#128229;</div>
                  <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
                    Drop a CSV or Excel file here
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">or click to browse</p>
                </div>
              )}
            </div>

            {file && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleParse}
                  disabled={parsing}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {parsing ? 'Analyzing...' : 'Continue'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Field Mapping */}
        {step === 'mapping' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Map Fields</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {totalRows} rows found. Map your source columns to CRM fields.
                  </p>
                </div>
                <button
                  onClick={() => { setStep('upload'); setFile(null); }}
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Change file
                </button>
              </div>

              {/* Import options */}
              <div className="flex gap-4 mb-4 p-3 bg-gray-50 dark:bg-gray-950 rounded-lg">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">Lead Source</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 dark:bg-gray-800 dark:text-gray-200"
                  >
                    <option value="OTHER">IF3 Import</option>
                    <option value="MANUAL">Manual</option>
                    <option value="PROPERTY_LEADS">PropertyLeads</option>
                    <option value="GOOGLE_ADS">Google Ads</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="rounded"
                  />
                  Skip duplicate phone numbers
                </label>
              </div>

              {/* Unmapped required fields warning */}
              {unmappedRequired.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-400 text-sm">
                  <span className="font-medium">Required fields not mapped:</span>{' '}
                  {unmappedRequired.map((f) => f.label).join(', ')}
                </div>
              )}

              {/* Mapping table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 pr-4 text-gray-600 dark:text-gray-400 font-medium w-1/4">Source Column</th>
                      <th className="text-left py-2 px-4 text-gray-600 dark:text-gray-400 font-medium w-1/4">Sample Data</th>
                      <th className="text-left py-2 px-4 text-gray-600 dark:text-gray-400 font-medium w-8">&rarr;</th>
                      <th className="text-left py-2 pl-4 text-gray-600 dark:text-gray-400 font-medium w-1/3">CRM Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((header, i) => {
                      const samples = sampleRows.slice(0, 3).map((r) => r[i]).filter((v) => v !== '' && v != null);
                      const currentTarget = mapping[header] || '';
                      return (
                        <tr key={header} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="py-2 pr-4">
                            <span className="font-medium text-gray-900 dark:text-gray-100">{header}</span>
                          </td>
                          <td className="py-2 px-4 text-gray-500 dark:text-gray-400 truncate max-w-[200px]" title={samples.join(', ')}>
                            {samples.slice(0, 2).map((s) => String(s).substring(0, 30)).join(', ') || <span className="text-gray-300 dark:text-gray-600 italic">empty</span>}
                          </td>
                          <td className="py-2 px-4 text-gray-400 dark:text-gray-500">&rarr;</td>
                          <td className="py-2 pl-4">
                            <select
                              value={currentTarget}
                              onChange={(e) => updateMapping(header, e.target.value)}
                              className={`w-full border rounded px-2 py-1 text-sm dark:bg-gray-800 dark:text-gray-200 ${
                                currentTarget ? 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950' : 'border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              <option value="">-- Skip --</option>
                              {availableFields.map((f) => (
                                <option key={f.key} value={f.key} disabled={mappedTargets.has(f.key) && mapping[header] !== f.key}>
                                  {f.label}{f.required ? ' *' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Preview */}
            {sampleRows.length > 0 && Object.keys(mapping).length > 0 && (
              <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Preview (first {Math.min(sampleRows.length, 3)} rows as mapped)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        {Object.entries(mapping).map(([src, target]) => (
                          <th key={src} className="text-left py-1 px-2 text-gray-600 dark:text-gray-400">
                            {availableFields.find((f) => f.key === target)?.label || target}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRows.slice(0, 3).map((row, ri) => (
                        <tr key={ri} className="border-b border-gray-50 dark:border-gray-800">
                          {Object.entries(mapping).map(([src]) => {
                            const idx = headers.indexOf(src);
                            return (
                              <td key={src} className="py-1 px-2 text-gray-700 dark:text-gray-300 truncate max-w-[150px]">
                                {idx >= 0 ? String(row[idx] ?? '') : ''}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <button
                onClick={() => { setStep('upload'); setFile(null); }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
              >
                &larr; Back
              </button>
              <button
                onClick={handleImport}
                disabled={unmappedRequired.length > 0 || importing}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                Import {totalRows} Leads
              </button>
            </div>
          </div>
        )}

        {/* Importing */}
        {step === 'importing' && (
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 rounded-full mx-auto mb-4" />
            <p className="text-lg font-medium text-gray-700 dark:text-gray-300">Importing leads...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Processing {totalRows} rows</p>
          </div>
        )}

        {/* Step 3: Results */}
        {step === 'results' && results && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Import Complete</h2>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-700 dark:text-green-400">{results.created}</div>
                  <div className="text-sm text-green-600 dark:text-green-400">Created</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{results.skipped}</div>
                  <div className="text-sm text-yellow-600 dark:text-yellow-400">Skipped (duplicates)</div>
                </div>
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-700 dark:text-red-400">{results.errors.length}</div>
                  <div className="text-sm text-red-600 dark:text-red-400">Errors</div>
                </div>
              </div>

              {results.errors.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Error Details</h3>
                  <div className="max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-950 rounded-lg p-3 text-xs">
                    {results.errors.slice(0, 50).map((e, i) => (
                      <div key={i} className="py-1 border-b border-gray-200 dark:border-gray-700 last:border-0">
                        <span className="text-gray-500 dark:text-gray-400">Row {e.row}:</span>{' '}
                        <span className="text-red-600 dark:text-red-400">{e.reason}</span>
                      </div>
                    ))}
                    {results.errors.length > 50 && (
                      <div className="py-1 text-gray-500 dark:text-gray-400">
                        ...and {results.errors.length - 50} more errors
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => { setStep('upload'); setFile(null); setResults(null); }}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
              >
                Import More
              </button>
              <Link
                href="/leads"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                View Leads
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
