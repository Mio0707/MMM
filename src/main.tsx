import React, {StrictMode, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class AppErrorBoundary extends React.Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('App render failed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f6f4fb] text-slate-950 flex flex-col items-center justify-center px-8 text-center">
          <p className="text-xl font-black mb-4">页面暂时无法显示</p>
          <button
            onClick={() => {
              window.location.hash = '#/';
              window.location.reload();
            }}
            className="rounded-full bg-white px-5 py-3 text-sm font-black shadow-sm border border-slate-200"
          >
            返回首页
          </button>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
