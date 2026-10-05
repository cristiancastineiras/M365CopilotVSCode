import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@/utils/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: 16, color: '#b91c1c' }}>
            <h2>{t('error.title')}</h2>
            <p style={{ fontSize: 12 }}>{this.state.message}</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
