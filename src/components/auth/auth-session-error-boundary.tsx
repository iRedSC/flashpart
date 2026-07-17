import * as React from "react";

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "string"
  ) {
    return error.data;
  }

  return "";
}

export function isAuthSessionError(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("Sign in again to continue") ||
    /\[CONVEX[^\]]*\][\s\S]*Sign in again/i.test(message)
  );
}

type AuthSessionErrorBoundaryProps = {
  children: React.ReactNode;
  onInvalidSession: () => void;
};

type AuthSessionErrorBoundaryState = {
  authFailed: boolean;
  fatalError: Error | null;
};

export class AuthSessionErrorBoundary extends React.Component<
  AuthSessionErrorBoundaryProps,
  AuthSessionErrorBoundaryState
> {
  state: AuthSessionErrorBoundaryState = {
    authFailed: false,
    fatalError: null,
  };

  static getDerivedStateFromError(
    error: unknown,
  ): Partial<AuthSessionErrorBoundaryState> {
    if (isAuthSessionError(error)) {
      return { authFailed: true, fatalError: null };
    }

    return {
      authFailed: false,
      fatalError: error instanceof Error ? error : new Error(errorMessage(error) || "Unexpected error"),
    };
  }

  componentDidCatch(error: unknown) {
    if (isAuthSessionError(error)) {
      this.props.onInvalidSession();
    }
  }

  render() {
    if (this.state.authFailed) {
      return null;
    }

    if (this.state.fatalError) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
          <div className="grid max-w-md gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-1">
              <h1 className="text-lg font-semibold text-slate-900">
                Something went wrong
              </h1>
              <p className="text-sm text-slate-500">
                {this.state.fatalError.message ||
                  "The app hit an unexpected error."}
              </p>
            </div>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
              onClick={this.props.onInvalidSession}
              type="button"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
