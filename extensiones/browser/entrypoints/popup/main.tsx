import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getLocale, t } from '@/utils/i18n';
import './style.css';

document.documentElement.lang = getLocale();
document.title = t('popup.title');

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('[popup] #root element not found in popup HTML');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);