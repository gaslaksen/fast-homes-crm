'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

// Isolates rendering errors inside the AI curation panel so a bug there
// can never break the existing Comps tab. Failure state is intentionally
// quiet — manual comp selection still works below.
export default class CurationErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    if (typeof window !== 'undefined' && window.console) {
      console.error('AI curation panel crashed:', error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-xs text-red-700 dark:text-red-400"
        >
          AI curation panel failed to render. Manual comp selection still
          works — refresh the page to retry the panel.
        </div>
      );
    }
    return this.props.children;
  }
}
