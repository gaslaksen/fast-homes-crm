'use client';
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function CompsRedirect() {
  const router = useRouter();
  const params = useParams();
  useEffect(() => {
    router.replace(`/leads/${params.id}/comps-analysis?tab=map`);
  }, [router, params.id]);
  return <div className="min-h-screen flex items-center justify-center text-gray-500">Redirecting...</div>;
}
