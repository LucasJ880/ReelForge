"use client";

import { AuthRouteError } from "@/components/auth/auth-route-error";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <AuthRouteError error={error} reset={reset} />;
}
