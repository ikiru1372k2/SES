import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Scoped error boundary — catches render crashes inside a page/section and
 * shows an inline fallback with a Retry button. Does NOT wipe localStorage
 * (unlike the global ErrorBoundary). Designed to wrap individual routes or
 * heavy components so a crash in one area doesn't blank the whole app.
 */
export class ScopedErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ScopedErrorBoundary: ${this.props.label ?? 'unknown'}]`, error, info);
  }

  private retry = () => this.setState({ error: null });

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 ring-4 ring-red-100 dark:bg-red-950 dark:ring-red-900">
          <AlertTriangle size={22} className="text-red-600 dark:text-red-400" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {this.props.label ?? 'This section'} ran into an error
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
        </div>
        <button
          onClick={this.retry}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <RefreshCw size={14} />
          Try again
        </button>
      </div>
    );
  }
}
