"use client";

import { CustomerRouteError } from "@/components/platform/customer-route-error";

export default function ErrorBoundary(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <CustomerRouteError {...props} route="templates" />;
}
