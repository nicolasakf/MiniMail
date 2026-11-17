import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportError } from "@/lib/events";

interface State {
  failed: boolean;
}

/**
 * Catches an error thrown while a screen renders, records it in the event journal (so it reaches
 * main.log and the Log) and offers a way back, instead of leaving a blank window.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = info.componentStack?.split("\n").find((line) => line.trim())?.trim();
    reportError("app", "A screen crashed while drawing", error, { context: where });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">Something went wrong in this window.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It was recorded in the notifications list. Reloading brings the window back; your mail is not affected.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Reload
        </button>
      </div>
    );
  }
}
