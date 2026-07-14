"use client";

import { SurfaceRouteError } from "@/components/layout/surface-route-error";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SurfaceRouteError area="public" error={error} reset={reset} />;
}
