import AppShell from '@/components/AppShell';

export default function InboxPage() {
  return (
    <AppShell>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Inbox</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Unified reply inbox across all leads is coming soon.
          </p>
        </div>
      </main>
    </AppShell>
  );
}
