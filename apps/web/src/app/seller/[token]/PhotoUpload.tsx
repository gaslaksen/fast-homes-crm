'use client';

import { useState, useRef, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface PhotoUploadProps {
  token: string;
  onUploadComplete: () => void;
}

export default function PhotoUpload({ token, onUploadComplete }: PhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [uploadCount, setUploadCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) {
      setError('Please select image files only.');
      return;
    }
    if (fileArray.length > 10) {
      setError('You can upload up to 10 photos at a time.');
      return;
    }

    // Check individual file sizes
    const oversized = fileArray.find((f) => f.size > 10 * 1024 * 1024);
    if (oversized) {
      setError(`"${oversized.name}" is too large. Maximum file size is 10MB.`);
      return;
    }

    setError('');
    setUploading(true);
    setUploadCount(0);

    const formData = new FormData();
    fileArray.forEach((f) => formData.append('photos', f));

    try {
      const res = await fetch(`${API_URL}/seller-portal/${token}/photos`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Upload failed');
      }

      const data = await res.json();
      setUploadCount(data.photoCount || fileArray.length);

      // Brief success display before refreshing
      setTimeout(() => {
        setUploadCount(0);
        onUploadComplete();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [token, onUploadComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  return (
    <div className="space-y-3">
      <div
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        {uploading ? (
          <div className="space-y-2">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-blue-600 font-medium">Uploading photos...</p>
          </div>
        ) : uploadCount > 0 ? (
          <div className="space-y-2">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-green-600 font-medium">
              {uploadCount} photo{uploadCount !== 1 ? 's' : ''} uploaded successfully!
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Tap to upload photos or drag and drop
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Up to 10 photos at a time, 10MB each. JPG, PNG, HEIC accepted.
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 text-center">{error}</p>
      )}
    </div>
  );
}
