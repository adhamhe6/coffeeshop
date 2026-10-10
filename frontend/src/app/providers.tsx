import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { AuthProvider } from './auth';
import { MoneyProvider, Toaster, TooltipProvider, Button } from '@/design';
import { useStore } from '@/lib/api/store';
import { configureSeo } from '@/lib/seo';

/** Last-resort boundary for errors above the router (providers, layouts). Route errors use `ErrorPage`. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <h1 className="font-display text-h2">Something went wrong</h1>
        <p className="text-text-muted">
          The page hit an unexpected problem. Reloading usually fixes it.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

/** Feeds store settings (currency, brand) to money formatting and SEO defaults. */
function StoreBridge({ children }: { children: ReactNode }) {
  const { data } = useStore();
  useEffect(() => {
    if (data) configureSeo({ siteName: data.brand_name, tagline: data.tagline });
  }, [data]);
  return <MoneyProvider currency={data?.currency ?? 'USD'}>{children}</MoneyProvider>;
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          <StoreBridge>
            <AuthProvider>{children}</AuthProvider>
          </StoreBridge>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
