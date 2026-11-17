/**
 * 字典结构类型 — 两个 locale 必须严格相等。
 *
 * 通过让 zh-CN 字典作为 source-of-truth 推导 Dictionary 类型，
 * 任何 en-US 缺 key 都会被 TypeScript 阻止编译。
 */

import type zhCN from "./dictionaries/zh-CN";

export type Dictionary = {
  common: {
    appName: string;
    appTagline: string;
    confirm: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    close: string;
    back: string;
    next: string;
    previous: string;
    loading: string;
    saving: string;
    submitting: string;
    retry: string;
    refresh: string;
    download: string;
    upload: string;
    copy: string;
    copied: string;
    or: string;
    optional: string;
    required: string;
    yes: string;
    no: string;
    advancedDetails: string;
    showAdvanced: string;
    hideAdvanced: string;
    logout: string;
    settings: string;
    language: string;
  };
  brand: {
    title: string;
    subtitle: string;
    logo: string;
    productPhotos: string;
    productVideos: string;
    primaryColor: string;
    style: string;
    upload: string;
    uploadLogo: string;
    noLogo: string;
    aiGenerateCta: string;
    replaceLogo: string;
    regenerate: string;
  };
  logo: {
    title: string;
    subtitle: string;
    form: {
      businessName: string;
      industry: string;
      style: string;
      colors: string;
      slogan: string;
      iconIdea: string;
    };
    style: {
      modern: string;
      minimal: string;
      luxury: string;
      playful: string;
      tech: string;
      natural: string;
      local: string;
    };
    actions: {
      generate: string;
      regenerate: string;
      select: string;
      cancel: string;
    };
    states: {
      generating: string;
      generated: string;
      failed: string;
      mockNotice: string;
    };
  };
  video: {
    title: string;
    subtitle: string;
    library: string;
    libraryEmpty: string;
    progress: {
      scriptReady: string;
      submitted: string;
      generating: string;
      stitching: string;
      ready: string;
      segments: string;
      segmentsAndStitch: string;
    };
    duration: {
      sec15: string;
      sec30: string;
      sec60: string;
    };
    actions: {
      preview: string;
      download: string;
      markFavorite: string;
      unmarkFavorite: string;
      regenerate: string;
      regenerateConfirm: string;
      retryFailed: string;
      refreshStatus: string;
    };
    states: {
      waiting: string;
      submitted: string;
      generating: string;
      stitching: string;
      ready: string;
      failed: string;
      stuck: string;
      cancelled: string;
    };
    helpers: {
      waiting: string;
      submitted: string;
      generating: string;
      stitching: string;
      ready: string;
      failed: string;
      stuck: string;
      cancelled: string;
    };
    quality: {
      pending: string;
      approved: string;
      rejected: string;
    };
  };
  shell: {
    signOut: string;
    platformNav: {
      create: string;
      batches: string;
      library: string;
      products: string;
      brands: string;
      templates: string;
      leads: string;
      guide: string;
    };
    platformShell: {
      primaryNav: string;
      mobileNav: string;
      currentPlan: string;
      switchWorkspace: string;
      oneWorkspaceHint: string;
      search: string;
      accountSignOut: string;
      activeBatches: string;
      failedJobs: string;
    };
    videoActions: {
      refresh: string;
      retryFailed: string;
      refreshFailed: string;
      retryFailedMsg: string;
      retryStarted: string;
      networkError: string;
    };
  };
  language: {
    switch: string;
    current: string;
  };
  debug: {
    title: string;
    show: string;
    hide: string;
    provider: string;
    externalJobId: string;
    rawStatus: string;
    advanced: string;
    devOnly: string;
  };
};

/**
 * 把嵌套字典对象的所有叶子路径展开成 dot-string 联合类型。
 * 例如 dict.video.progress.ready → "video.progress.ready".
 */
export type DotPath<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? DotPath<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

export type TranslationKey = DotPath<Dictionary>;

/// 编译期断言：zh-CN 字典必须严格满足 Dictionary 形状
type _AssertZh = typeof zhCN extends Dictionary ? true : false;
const _zhAssert: _AssertZh = true;
void _zhAssert;
