'use client';

import { useState } from 'react';

interface SaveSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  activeFilterCount: number;
}

export default function SaveSearchModal({ isOpen, onClose, onSave, activeFilterCount }: SaveSearchModalProps) {
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    if (name.trim()) {
      onSave(name.trim());
      setName('');
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="card max-w-md w-full shadow-xl">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
            Save Search
          </h3>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                Search Name
              </label>
              <input
                type="text"
                className="input w-full"
                placeholder="e.g. Miami High Equity SFR"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                autoFocus
              />
            </div>

            <div className="text-sm text-gray-500 dark:text-gray-400">
              {activeFilterCount} active filter{activeFilterCount !== 1 ? 's' : ''} will be saved
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="btn btn-sm">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="btn btn-primary btn-sm disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
