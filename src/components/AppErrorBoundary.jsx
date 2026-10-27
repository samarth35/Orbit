import { Component } from 'react';

export function reloadWorkspace() {
  const url = new URL(window.location.href);
  url.searchParams.set('orbit_refresh', Date.now().toString());
  window.location.replace(url.href);
}

export default class AppErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <main className="workspace-recovery" role="alert">
        <h1>Orbit couldn’t open this workspace.</h1>
        <p>Your saved work is still on the server. Reload to try again.</p>
        <button type="button" onClick={reloadWorkspace}>Reload workspace</button>
      </main>;
    }
    return this.props.children;
  }
}
