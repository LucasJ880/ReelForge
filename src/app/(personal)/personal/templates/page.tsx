"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCreatePrefill } from "@/components/personal/upload-assets";
import {
  CONSISTENCY_LOCKS,
  STYLE_TEMPLATES,
  STYLE_TEMPLATE_CATEGORIES,
  type StyleTemplate,
} from "@/lib/video-generation/style-templates";

/**
 * 提示词库（风格模版库）—— 对齐同行「skill 模式」：
 * 模版是后端固化的风格底盘（视觉语言/镜头语言/台词口吻），
 * 前端只做展示与「套用」；一致性锁可叠加勾选后一起带入创作页。
 */

type CategoryFilter = "全部" | (typeof STYLE_TEMPLATE_CATEGORIES)[number];

export default function TemplatesPage() {
  const router = useRouter();
  const [category, setCategory] = useState<CategoryFilter>("全部");
  const [selectedLocks, setSelectedLocks] = useState<string[]>([
    "lock_product_shape",
    "lock_hands",
  ]);

  const templates = useMemo(
    () =>
      category === "全部"
        ? STYLE_TEMPLATES
        : STYLE_TEMPLATES.filter((t) => t.category === category),
    [category],
  );

  function toggleLock(id: string) {
    setSelectedLocks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function applyTemplate(tpl: StyleTemplate) {
    saveCreatePrefill({
      prompt: tpl.samplePrompt,
      duration: tpl.defaults.durationSec,
      mode: "fast",
      styleTemplateId: tpl.id,
      consistencyLockIds: selectedLocks,
      language: tpl.defaults.language,
    });
    router.push("/personal/create-video?from=template");
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            提示词库 · 风格模版
          </h1>
          <p className="mt-1 text-xs" style={{ color: "var(--glass-text-dim)" }}>
            后端固化的实战风格模版 — 「套用」直接带入创作流程，风格/镜头/一致性全部锁定
          </p>
        </div>
      </header>

      {/* 分类 tab */}
      <div className="flex flex-wrap gap-2">
        {(["全部", ...STYLE_TEMPLATE_CATEGORIES] as CategoryFilter[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={
              c === category
                ? "glass-btn-primary px-4 py-1.5 text-xs"
                : "glass-btn px-4 py-1.5 text-xs"
            }
          >
            {c}
          </button>
        ))}
      </div>

      {/* 模版网格 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {templates.map((tpl) => (
          <div key={tpl.id} className="glass-card flex flex-col p-5">
            <div className="flex items-start justify-between">
              <span className="text-2xl">{tpl.icon}</span>
              <div className="flex items-center gap-1.5">
                {tpl.featured && (
                  <span className="glass-chip text-[10px] text-amber-300">⭐ 推荐</span>
                )}
                <span className="glass-chip text-[10px]">{tpl.category}</span>
              </div>
            </div>
            <h2 className="mt-3 text-sm font-semibold text-white">{tpl.name}</h2>
            <p
              className="mt-1 flex-1 text-xs leading-relaxed"
              style={{ color: "var(--glass-text-dim)" }}
            >
              {tpl.description}
            </p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--glass-text-dim)" }}>
                {tpl.defaults.durationSec}s ·{" "}
                {tpl.scaffold.dialogueStyle ? "含口播" : "纯质感"}
              </span>
              <button
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="glass-btn-primary px-4 py-1.5 text-xs"
              >
                套用
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 一致性锁（可叠加，套用模版时一起带入） */}
      <section className="glass-panel p-5">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">一致性锁</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--glass-text-dim)" }}>
              可叠加的生成约束 — 勾选后随任意模版一起生效
            </p>
          </div>
          <span className="glass-chip text-[10px]">
            已选 {selectedLocks.length} 项
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {CONSISTENCY_LOCKS.map((lock) => {
            const active = selectedLocks.includes(lock.id);
            return (
              <button
                key={lock.id}
                type="button"
                onClick={() => toggleLock(lock.id)}
                className={`rounded-xl border p-3.5 text-left transition ${
                  active
                    ? "border-sky-400/60 bg-sky-400/10"
                    : "border-white/10 bg-black/20 hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-lg">{lock.icon}</span>
                  <span
                    className={`text-[10px] font-medium ${
                      active ? "text-sky-300" : "text-white/40"
                    }`}
                  >
                    {active ? "已启用" : "未启用"}
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold text-white">{lock.name}</p>
                <p
                  className="mt-1 text-[11px] leading-relaxed"
                  style={{ color: "var(--glass-text-dim)" }}
                >
                  {lock.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
