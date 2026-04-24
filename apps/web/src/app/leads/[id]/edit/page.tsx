'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI } from '@/lib/api';

const DISTRESS_SIGNAL_OPTIONS = [
  { value: 'vacant', label: 'Vacant' },
  { value: 'foreclosure', label: 'Foreclosure' },
  { value: 'code_violations', label: 'Code Violations' },
  { value: 'major_repairs', label: 'Major Repairs' },
];

export default function EditLeadPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    status: '',
    source: '',
    propertyAddress: '',
    propertyCity: '',
    propertyState: '',
    propertyZip: '',
    propertyType: '',
    bedrooms: '',
    bathrooms: '',
    sqft: '',
    sqftOverride: '',
    sellerFirstName: '',
    sellerLastName: '',
    sellerPhone: '',
    sellerEmail: '',
    timeline: '',
    askingPrice: '',
    conditionLevel: '',
    ownershipStatus: '',
    distressSignals: [] as string[],
    arv: '',
    doNotContact: false,
    tags: '',
  });

  useEffect(() => {
    loadLead();
  }, [leadId]);

  const loadLead = async () => {
    try {
      const response = await leadsAPI.get(leadId);
      const lead = response.data;
      setFormData({
        status: lead.status || '',
        source: lead.source || '',
        propertyAddress: lead.propertyAddress || '',
        propertyCity: lead.propertyCity || '',
        propertyState: lead.propertyState || '',
        propertyZip: lead.propertyZip || '',
        propertyType: lead.propertyType || '',
        bedrooms: lead.bedrooms?.toString() || '',
        bathrooms: lead.bathrooms?.toString() || '',
        sqft: lead.sqft?.toString() || '',
        sqftOverride: lead.sqftOverride?.toString() || '',
        sellerFirstName: lead.sellerFirstName || '',
        sellerLastName: lead.sellerLastName || '',
        sellerPhone: lead.sellerPhone || '',
        sellerEmail: lead.sellerEmail || '',
        timeline: lead.timeline?.toString() || '',
        askingPrice: lead.askingPrice?.toString() || '',
        conditionLevel: lead.conditionLevel || '',
        ownershipStatus: lead.ownershipStatus || '',
        distressSignals: Array.isArray(lead.distressSignals) ? lead.distressSignals : [],
        arv: lead.arv?.toString() || '',
        doNotContact: lead.doNotContact || false,
        tags: Array.isArray(lead.tags) ? lead.tags.join(', ') : '',
      });
    } catch (error) {
      console.error('Failed to load lead:', error);
      alert('Failed to load lead');
      router.push('/leads');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setFormData({ ...formData, [name]: (e.target as HTMLInputElement).checked });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleDistressSignalToggle = (signal: string) => {
    setFormData((prev) => ({
      ...prev,
      distressSignals: prev.distressSignals.includes(signal)
        ? prev.distressSignals.filter((s) => s !== signal)
        : [...prev.distressSignals, signal],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload: any = {
        status: formData.status,
        source: formData.source,
        propertyAddress: formData.propertyAddress,
        propertyCity: formData.propertyCity,
        propertyState: formData.propertyState,
        propertyZip: formData.propertyZip,
        propertyType: formData.propertyType || undefined,
        bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : undefined,
        bathrooms: formData.bathrooms ? parseFloat(formData.bathrooms) : undefined,
        sqft: formData.sqft ? parseInt(formData.sqft) : undefined,
        sqftOverride: formData.sqftOverride ? parseInt(formData.sqftOverride) : null,
        sellerFirstName: formData.sellerFirstName,
        sellerLastName: formData.sellerLastName,
        sellerPhone: formData.sellerPhone,
        sellerEmail: formData.sellerEmail || undefined,
        timeline: formData.timeline ? parseInt(formData.timeline) : null,
        askingPrice: formData.askingPrice ? parseFloat(formData.askingPrice) : null,
        conditionLevel: formData.conditionLevel || null,
        ownershipStatus: formData.ownershipStatus || null,
        distressSignals: formData.distressSignals.length > 0 ? formData.distressSignals : undefined,
        arv: formData.arv ? parseFloat(formData.arv) : undefined,
        doNotContact: formData.doNotContact,
        tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      };

      await leadsAPI.update(leadId, payload);
      router.push(`/leads/${leadId}`);
    } catch (error: any) {
      alert('Failed to update lead: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center dark:bg-gray-950 dark:text-gray-400">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Edit Lead</h1>
            <Link href={`/leads/${leadId}`} className="text-primary-600 hover:text-primary-700">
              &larr; Back to Lead
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Status & Source */}
          <div className="card">
            <h2 className="text-lg font-bold mb-4">Lead Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                <select name="status" value={formData.status} onChange={handleChange} className="input">
                  <option value="NEW">New</option>
                  <option value="ATTEMPTING_CONTACT">Attempting Contact</option>

                  <option value="QUALIFYING">Qualifying</option>
                  <option value="OFFER_SENT">Offer Made</option>
                  <option value="UNDER_CONTRACT">Under Contract</option>
                  <option value="CLOSING">Closing</option>
                  <option value="CLOSED_WON">Closed Won</option>
                  <option value="CLOSED_LOST">Closed Lost</option>
                  <option value="NURTURE">Nurture</option>
                  <option value="DEAD">💀 Dead</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source</label>
                <select name="source" value={formData.source} onChange={handleChange} className="input">
                  <option value="MANUAL">Manual</option>
                  <option value="PROPERTY_LEADS">Property Leads</option>
                  <option value="GOOGLE_ADS">Google Ads</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="doNotContact"
                  name="doNotContact"
                  checked={formData.doNotContact}
                  onChange={handleChange}
                  className="h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600"
                />
                <label htmlFor="doNotContact" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Do Not Contact
                </label>
              </div>
            </div>
          </div>

          {/* Property Information */}
          <div className="card">
            <h2 className="text-lg font-bold mb-4">Property Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Street Address *</label>
                <input
                  type="text"
                  name="propertyAddress"
                  value={formData.propertyAddress}
                  onChange={handleChange}
                  className="input"
                  placeholder="123 Main St"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City *</label>
                <input
                  type="text"
                  name="propertyCity"
                  value={formData.propertyCity}
                  onChange={handleChange}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State *</label>
                <input
                  type="text"
                  name="propertyState"
                  value={formData.propertyState}
                  onChange={handleChange}
                  className="input"
                  maxLength={2}
                  placeholder="NC"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ZIP Code *</label>
                <input
                  type="text"
                  name="propertyZip"
                  value={formData.propertyZip}
                  onChange={handleChange}
                  className="input"
                  placeholder="28202"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Property Type</label>
                <select name="propertyType" value={formData.propertyType} onChange={handleChange} className="input">
                  <option value="">--</option>
                  <option>Single Family</option>
                  <option>Townhouse</option>
                  <option>Condo</option>
                  <option>Multi-Family</option>
                  <option>Land</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bedrooms</label>
                <input type="number" name="bedrooms" value={formData.bedrooms} onChange={handleChange} className="input" min="0" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bathrooms</label>
                <input type="number" name="bathrooms" value={formData.bathrooms} onChange={handleChange} className="input" step="0.5" min="0" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Square Feet <span className="text-xs text-gray-400 dark:text-gray-500">(from ATTOM)</span></label>
                <input type="number" name="sqft" value={formData.sqft} onChange={handleChange} className="input" min="0" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sq Ft Override
                  <span className="ml-1 text-xs text-amber-600 dark:text-amber-400 font-normal">used for ARV if set</span>
                </label>
                <input
                  type="number"
                  name="sqftOverride"
                  value={formData.sqftOverride}
                  onChange={handleChange}
                  className="input border-amber-300 dark:border-amber-800 focus:ring-amber-400"
                  min="0"
                  placeholder="e.g. 1868 (Zillow/agent reported)"
                />
              </div>
            </div>
          </div>

          {/* Seller Information */}
          <div className="card">
            <h2 className="text-lg font-bold mb-4">Seller Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name *</label>
                <input type="text" name="sellerFirstName" value={formData.sellerFirstName} onChange={handleChange} className="input" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name *</label>
                <input type="text" name="sellerLastName" value={formData.sellerLastName} onChange={handleChange} className="input" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone *</label>
                <input type="tel" name="sellerPhone" value={formData.sellerPhone} onChange={handleChange} className="input" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input type="email" name="sellerEmail" value={formData.sellerEmail} onChange={handleChange} className="input" />
              </div>
            </div>
          </div>

          {/* Motivation & Scoring Inputs */}
          <div className="card">
            <h2 className="text-lg font-bold mb-4">Motivation & Scoring</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Changing these fields will automatically rescore the lead.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timeline (days)</label>
                <input
                  type="number"
                  name="timeline"
                  value={formData.timeline}
                  onChange={handleChange}
                  className="input"
                  placeholder="30"
                  min="0"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">&lt;14 days = high priority</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Asking Price</label>
                <input
                  id="askingPrice-input"
                  type="number"
                  name="askingPrice"
                  value={formData.askingPrice}
                  onChange={handleChange}
                  className="input"
                  placeholder="200000"
                  min="0"
                  autoFocus={typeof window !== 'undefined' && window.location.hash === '#asking'}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ARV (After Repair Value)</label>
                <input
                  type="number"
                  name="arv"
                  value={formData.arv}
                  onChange={handleChange}
                  className="input"
                  placeholder="300000"
                  min="0"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Used to calculate money score</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Property Condition</label>
                <select name="conditionLevel" value={formData.conditionLevel} onChange={handleChange} className="input">
                  <option value="">--</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                  <option value="distressed">Distressed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ownership Status</label>
                <select name="ownershipStatus" value={formData.ownershipStatus} onChange={handleChange} className="input">
                  <option value="">--</option>
                  <option value="sole_owner">Sole Owner</option>
                  <option value="co_owner">Co-Owner</option>
                  <option value="heir">Heir</option>
                  <option value="not_owner">Not Owner</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Distress Signals</label>
                <div className="flex flex-wrap gap-3">
                  {DISTRESS_SIGNAL_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.distressSignals.includes(option.value)}
                        onChange={() => handleDistressSignalToggle(option.value)}
                        className="h-4 w-4 text-primary-600 rounded border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="card">
            <h2 className="text-lg font-bold mb-4">Tags</h2>
            <input
              type="text"
              name="tags"
              value={formData.tags}
              onChange={handleChange}
              className="input"
              placeholder="tag1, tag2, tag3"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Comma-separated</p>
          </div>

          {/* Actions */}
          <div className="flex gap-4">
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <Link href={`/leads/${leadId}`} className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
