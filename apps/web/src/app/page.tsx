'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { hasLiveToken } from '@/lib/session';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // A signed-in user goes to the dashboard. This used to send everyone to
    // /login, which made the bare site address look like a sign-out.
    router.replace(hasLiveToken() ? '/dashboard' : '/login');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg">Redirecting...</div>
    </div>
  );
}
