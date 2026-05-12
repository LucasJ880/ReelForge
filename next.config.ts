import type { NextConfig } from "next";

/**
 * Phase 5 — legacy URL redirects.
 *
 * 老路径 308 permanent redirect 到 /internal/* 或 /business/*；
 * /wizard/* 由 middleware.ts 直接返回 410 Gone（旧 wizard 已下线）。
 *
 * 308 vs 301: 308 在 method 改变方面更严格（GET/POST 都保留 method）；
 * 这些路径都是页面 GET，影响等价。
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Operator / internal tooling 全部归到 /internal/*
      { source: "/orders", destination: "/internal/orders", permanent: true },
      { source: "/orders/:path*", destination: "/internal/orders/:path*", permanent: true },
      { source: "/rounds", destination: "/internal/rounds", permanent: true },
      { source: "/rounds/:path*", destination: "/internal/rounds/:path*", permanent: true },
      { source: "/briefs", destination: "/internal/briefs", permanent: true },
      { source: "/briefs/:path*", destination: "/internal/briefs/:path*", permanent: true },
      { source: "/qa", destination: "/internal/qa", permanent: true },
      { source: "/qa/:path*", destination: "/internal/qa/:path*", permanent: true },
      { source: "/publish", destination: "/internal/publish", permanent: true },
      { source: "/publish/:path*", destination: "/internal/publish/:path*", permanent: true },
      { source: "/metrics", destination: "/internal/metrics", permanent: true },
      { source: "/metrics/:path*", destination: "/internal/metrics/:path*", permanent: true },
      { source: "/distillation", destination: "/internal/distillation", permanent: true },
      { source: "/distillation/:path*", destination: "/internal/distillation/:path*", permanent: true },
      { source: "/demo-leads", destination: "/internal/demo-leads", permanent: true },
      { source: "/demo-leads/:path*", destination: "/internal/demo-leads/:path*", permanent: true },
      { source: "/admin/ai-usage", destination: "/internal/ai-usage", permanent: true },
      { source: "/admin/ai-usage/:path*", destination: "/internal/ai-usage/:path*", permanent: true },
      { source: "/admin", destination: "/internal", permanent: true },
      { source: "/settings", destination: "/internal/settings", permanent: true },
      { source: "/settings/:path*", destination: "/internal/settings/:path*", permanent: true },

      // Customer-facing projects → business products
      { source: "/projects", destination: "/business/products", permanent: true },
      { source: "/projects/:path*", destination: "/business/products/:path*", permanent: true },
      // Legacy /videos was an operator-friendly aggregate; redirect to internal until Phase 2
      // splits it explicitly into business + personal libraries.
      { source: "/videos", destination: "/internal/videos", permanent: true },
      { source: "/videos/:path*", destination: "/internal/videos/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
