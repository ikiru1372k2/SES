import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Workbook Auditor crashed', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6 text-gray-950">
        <div className="max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-red-700">Workbook Auditor could not load</h1>
          <p className="mt-2 text-sm text-gray-600">{this.state.error.message}</p>
          <button
            className="mt-4 rounded-lg bg-[#b00020] px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              localStorage.removeItem('effort-auditor-data');
              localStorage.removeItem('effort-auditor-ui');
              window.location.href = '/taskpane.html';
            }}
          >
            Reset local app data
          </button>
        </div>
      </div>
    );
  }
}
