'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { leadsAPI } from '@/lib/api';

/** Normalize any US phone input to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export default function NewLeadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    source: 'MANUAL',
    propertyAddress: '',
    propertyCity: '',
    propertyState: '',
    propertyZip: '',
    propertyType: 'Single Family',
    bedrooms: '',
    bathrooms: '',
    sqft: '',
    sellerFirstName: '',
    sellerLastName: '',
    sellerPhone: '',
    sellerEmail: '',
    timeline: '',
    askingPrice: '',
    conditionLevel: '',
    ownershipStatus: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const normalizedPhone = normalizePhone(formData.sellerPhone);
      if (!normalizedPhone) {
        alert('Please enter a valid 10-digit US phone number.');
        setLoading(false);
        return;
      }

      const payload = {
        ...formData,
        sellerPhone: normalizedPhone,
        bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : undefined,
        bathrooms: formData.bathrooms ? parseFloat(formData.bathrooms) : undefined,
        sqft: formData.sqft ? parseInt(formData.sqft) : undefined,
        timeline: formData.timeline ? parseInt(formData.timeline) : undefined,
        askingPrice: formData.askingPrice ? parseFloat(formData.askingPrice) : undefined,
        // Don't send blank CAMP fields — let the AI drip fill them in
        conditionLevel: formData.conditionLevel || undefined,
        ownershipStatus: formData.ownershipStatus || undefined,
      };

      const response = await leadsAPI.create(payload);
      router.push(`/leads/${response.data.id}`);
    } catch (error: any) {
      alert('Failed to create lead: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Create New Lead</h1>
            <Link href="/leads" className="text-primary-600 hover:text-primary-700">
              &larr; Back to Leads
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <form onSubmit={handleSubmit} className="card space-y-6">
          {/* Property Information */}
          <div>
            <h2 className="text-lg font-bold mb-4">Property Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Street Address *
                </label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  City *
                </label>
                <input
                  type="text"
                  name="propertyCity"
                  value={formData.propertyCity}
                  onChange={handleChange}
                  className="input bg-gray-50 dark:bg-gray-950"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  State *
                </label>
                <input
                  type="text"
                  name="propertyState"
                  value={formData.propertyState}
                  onChange={handleChange}
                  className="input bg-gray-50 dark:bg-gray-950"
                  maxLength={2}
                  placeholder="NC"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  ZIP Code *
                </label>
                <input
                  type="text"
                  name="propertyZip"
                  value={formData.propertyZip}
                  onChange={handleChange}
                  className="input bg-gray-50 dark:bg-gray-950"
                  placeholder="28202"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Property Type
                </label>
                <select
                  name="propertyType"
                  value={formData.propertyType}
                  onChange={handleChange}
                  className="input"
                >
                  <option>Single Family</option>
                  <option>Townhouse</option>
                  <option>Condo</option>
                  <option>Multi-Family</option>
                  <option>Land</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bedrooms
                </label>
                <input
                  type="number"
                  name="bedrooms"
                  value={formData.bedrooms}
                  onChange={handleChange}
                  className="input"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Bathrooms
                </label>
                <input
                  type="number"
                  name="bathrooms"
                  value={formData.bathrooms}
                  onChange={handleChange}
                  className="input"
                  step="0.5"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Square Feet
                </label>
                <input
                  type="number"
                  name="sqft"
                  value={formData.sqft}
                  onChange={handleChange}
                  className="input"
                  min="0"
                />
              </div>
            </div>
          </div>

          {/* Seller Information */}
          <div>
            <h2 className="text-lg font-bold mb-4">Seller Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  name="sellerFirstName"
                  value={formData.sellerFirstName}
                  onChange={handleChange}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  name="sellerLastName"
                  value={formData.sellerLastName}
                  onChange={handleChange}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Phone *
                </label>
                <input
                  type="tel"
                  name="sellerPhone"
                  value={formData.sellerPhone}
                  onChange={handleChange}
                  className="input"
                  placeholder="(704) 555-1234"
                  required
                />
                {formData.sellerPhone && (
                  <p className={`text-xs mt-1 ${normalizePhone(formData.sellerPhone) ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {normalizePhone(formData.sellerPhone)
                      ? `Will be saved as ${normalizePhone(formData.sellerPhone)}`
                      : 'Enter a valid 10-digit US number'}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  name="sellerEmail"
                  value={formData.sellerEmail}
                  onChange={handleChange}
                  className="input"
                />
              </div>
            </div>
          </div>

          {/* Motivation/Scoring */}
          <div>
            <h2 className="text-lg font-bold mb-4">Motivation & Scoring</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Timeline (days)
                </label>
                <input
                  type="number"
                  name="timeline"
                  value={formData.timeline}
                  onChange={handleChange}
                  className="input"
                  placeholder="30"
                  min="0"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  &lt;14 days = high priority
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Asking Price
                </label>
                <input
                  type="number"
                  name="askingPrice"
                  value={formData.askingPrice}
                  onChange={handleChange}
                  className="input"
                  placeholder="200000"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Property Condition
                </label>
                <select
                  name="conditionLevel"
                  value={formData.conditionLevel}
                  onChange={handleChange}
                  className="input"
                >
                  <option value=""></option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                  <option value="distressed">Distressed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Ownership Status
                </label>
                <select
                  name="ownershipStatus"
                  value={formData.ownershipStatus}
                  onChange={handleChange}
                  className="input"
                >
                  <option value=""></option>
                  <option value="sole_owner">Sole Owner</option>
                  <option value="co_owner">Co-Owner</option>
                  <option value="heir">Heir</option>
                  <option value="not_owner">Not Owner</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary flex-1"
            >
              {loading ? 'Creating...' : 'Create Lead'}
            </button>
            <Link href="/leads" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
