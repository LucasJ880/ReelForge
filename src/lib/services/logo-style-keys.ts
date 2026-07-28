/**
 * Client-safe logo style constants.
 *
 * 必须与 logo-service.ts 分开：logo-service 顶层 import 了 @/lib/ai（模块作用域
 * 构造 OpenAI）与 @/lib/db（Prisma）。"use client" 组件一旦从 logo-service 取
 * **运行时值**（如 LOGO_STYLE_KEYS），Turbopack 会把整张服务端模块图打进浏览器
 * bundle，导致 `new OpenAI()` 在浏览器执行并抛
 * "It looks like you're running in a browser-like environment."
 * —— 0726 /app/brands 整页 500 的根因。
 *
 * 规则：客户端组件只能从这里取样式常量，永远不要从 logo-service 取值。
 * 回归测试：tests/client-bundle-safety.test.ts
 */

export const LOGO_STYLE_KEYS = [
  "modern",
  "minimal",
  "luxury",
  "playful",
  "tech",
  "natural",
  "local",
] as const;

export type LogoStyleKey = (typeof LOGO_STYLE_KEYS)[number];
