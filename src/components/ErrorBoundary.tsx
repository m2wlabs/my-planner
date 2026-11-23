import { Component, type ReactNode } from "react";

/**
 * Without a boundary, any render-time exception unmounts the whole React tree and
 * leaves the Tauri window pure white. This keeps a readable recovery screen on
 * screen instead, with the data untouched in SQLite.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("My Planner hit an unrecoverable render error", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <h1>My Planner hit a problem</h1>
          <p>Nothing was lost — tasks, time and money are still in the local database.</p>
          <pre>{error.message || String(error)}</pre>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
