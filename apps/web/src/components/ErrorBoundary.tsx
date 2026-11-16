import { Component, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  /** When this changes after a failure, the content is tried again. */
  resetKey?: string;
};

type ErrorBoundaryState = {
  failed: boolean;
};

/** Shows a short message in place of content that failed to render. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="narrow">
        <div className="notice notice-error">
          <p role="alert">Something went wrong on this page.</p>
          <button type="button" className="button button-quiet" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
