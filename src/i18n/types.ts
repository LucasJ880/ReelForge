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
  nav: {
    projects: string;
    videos: string;
    publish: string;
    metrics: string;
    advancedSection: string;
    creativeSets: string;
    creativeBriefs: string;
    qualityCheck: string;
    distillation: string;
    demoLeads: string;
    aiUsage: string;
    settings: string;
    classicWizard: string;
  };
  role: {
    superAdmin: string;
    operator: string;
    reviewer: string;
  };
  project: {
    title: string;
    create: string;
    list: string;
    detail: string;
    empty: string;
    listSubtitle: string;
    fields: {
      businessName: string;
      productName: string;
      website: string;
      audience: string;
      sellingPoints: string;
      language: string;
      platform: string;
      duration: string;
      title: string;
      country: string;
      industry: string;
      objective: string;
      platforms: string;
      brandTone: string;
      keyMessage: string;
      cta: string;
      creativeDirection: string;
    };
    duration: {
      label: string;
      sublabel: string;
      sec15: string;
      sec15Sub: string;
      sec30: string;
      sec30Sub: string;
      sec60: string;
      sec60Sub: string;
    };
    platform: {
      tiktok: string;
      reels: string;
      shorts: string;
    };
    actions: {
      next: string;
      saveAndContinue: string;
    };
    card: {
      untitled: string;
      updatedAt: string;
      noStatusYet: string;
      noThumbnailHint: string;
    };
    page: {
      subtitle: string;
      notFound: string;
      backToList: string;
      noVideoYet: string;
      finalVideoTitle: string;
      progressTitle: string;
      noCreativeDirection: string;
    };
  };
  wizard: {
    layout: {
      stepsAriaLabel: string;
      stepLockedHint: string;
    };
    step: {
      kickoff: string;
      creative: string;
      script: string;
      storyboard: string;
      assets: string;
      render: string;
    };
    summary: {
      briefMissing: string;
      referenceDirection: string;
    };
    index: {
      pageTitle: string;
      pageSubtitle: string;
      newButton: string;
      existingTitle: string;
      empty: string;
      briefIncomplete: string;
    };
    step1: {
      pageTitle: string;
      pageSubtitle: string;
      basicInfo: string;
      businessName: string;
      businessNamePlaceholder: string;
      industry: string;
      objective: string;
      platforms: string;
      brandTone: string;
      keyMessage: string;
      keyMessagePlaceholder: string;
      brandAssetsCard: string;
      brandLogoUrl: string;
      brandLogoUrlPlaceholder: string;
      brandWebsite: string;
      brandWebsitePlaceholder: string;
      brandPhone: string;
      brandPhonePlaceholder: string;
      brandCta: string;
      brandCtaPlaceholder: string;
      brandPrimaryColor: string;
      brandPrimaryColorPlaceholder: string;
      consentsTitle: string;
      consentOwnsFootage: string;
      consentNoUnauthorizedAvatar: string;
      consentNoUnauthorizedVoiceClone: string;
      continueButton: string;
      errorConsentsRequired: string;
      errorBusinessNameTooShort: string;
      errorRequestFailed: string;
    };
    step2: {
      pageTitle: string;
      pageSubtitle: string;
      recommendedTitle: string;
      recommendedSubtitle: string;
      libraryTitle: string;
      libraryCount: string;
      libraryEmpty: string;
      selectionRequired: string;
      confirmAndContinue: string;
      back: string;
      referenceLink: string;
    };
    step3: {
      pageTitle: string;
      pageSubtitle: string;
      mockNotice: string;
      noDirectionWarning: string;
      cardTitleEmpty: string;
      cardTitleVersion: string;
      generateButton: string;
      regenerateButton: string;
      hookField: string;
      ctaField: string;
      fullTextField: string;
      saveButton: string;
      intro: string;
      bannerMockGenerated: string;
      bannerLiveGenerated: string;
      bannerSaved: string;
      back: string;
      continueButton: string;
    };
    step4: {
      pageTitle: string;
      pageSubtitle: string;
      mockNotice: string;
      noScriptWarning: string;
      cardTitleEmpty: string;
      cardTitleCount: string;
      generateButton: string;
      regenerateButton: string;
      intro: string;
      bannerMockGenerated: string;
      bannerLiveGenerated: string;
      shotLabel: string;
      requiredBadge: string;
      optionalBadge: string;
      humanBadge: string;
      propsLabel: string;
      captionLabel: string;
      back: string;
      continueButton: string;
    };
    step5: {
      pageTitle: string;
      pageSubtitle: string;
      bannerBlobReady: string;
      bannerBlobMissing: string;
      back: string;
      continueAllCovered: string;
      continueMockOnly: string;
      continueSkipMissing: string;
      uploadDisabledHint: string;
    };
    step6: {
      pageTitle: string;
      pageSubtitle: string;
      bannerLive: string;
      bannerDraft: string;
      reason: {
        previewModeDisabled: string;
        assemblyUnavailable: string;
      };
      triggerCardTitle: string;
      triggerButton: string;
      triggerHelp: string;
      recentTitle: string;
      recentEmpty: string;
      back: string;
    };
    overview: {
      goalsLocked: string;
      nextStep: string;
      continueDescription: string;
      continueToCreative: string;
      briefIncomplete: string;
      briefIncompleteDesc: string;
      backToWizardHome: string;
      businessLabel: string;
      industryLabel: string;
      objectiveLabel: string;
      platformsLabel: string;
      durationLabel: string;
      toneLabel: string;
      keyMessageLabel: string;
      ctaLabel: string;
    };
  };
  industry: Record<string, string>;
  objective: Record<string, string>;
  platform: Record<string, string>;
  brandTone: Record<string, string>;
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
  creative: {
    title: string;
    subtitle: string;
    direction: string;
    directions: string;
    hook: string;
    mainIdea: string;
    targetAudience: string;
    visualStyle: string;
    cta: string;
    set: string;
    brief: string;
    type: {
      optimization: string;
      exploration: string;
    };
    actions: {
      generateDirections: string;
      regenerateDirections: string;
      generateVideos: string;
      generateVideosCount: string;
      pickThis: string;
      preview: string;
    };
    empty: string;
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
  status: {
    project: Record<string, string>;
    set: Record<string, string>;
    brief: Record<string, string>;
    publish: Record<string, string>;
    qa: Record<string, string>;
    qaRoute: Record<string, string>;
    finalVideo: Record<string, string>;
  };
  shell: {
    signOut: string;
    personaBusiness: string;
    personaPersonal: string;
    badgeSoon: string;
    businessNav: {
      home: string;
      createAd: string;
      products: string;
      creativeStudio: string;
      integrations: string;
      performance: string;
      recommendations: string;
      billing: string;
    };
    personalNav: {
      home: string;
      createVideo: string;
      myVideos: string;
      templates: string;
      billing: string;
    };
    businessHome: {
      title: string;
      subtitle: string;
      createKicker: string;
      createTitle: string;
      createBody: string;
      productsKicker: string;
      productsTitle: string;
      productsBody: string;
      studioKicker: string;
      studioTitle: string;
      studioBody: string;
      perfKicker: string;
      perfTitle: string;
      perfBody: string;
    };
    personalHome: {
      title: string;
      subtitle: string;
      createKicker: string;
      createTitle: string;
      createBody: string;
      libraryKicker: string;
      libraryTitle: string;
      libraryBody: string;
    };
    personalVideos: {
      subtitle: string;
      emptyTitle: string;
      emptyBody: string;
      emptyCta: string;
    };
    billing: {
      kicker: string;
      title: string;
      subtitleBusiness: string;
      subtitlePersonal: string;
      refresh: string;
      refreshing: string;
      period: string;
      plan: string;
      exempt: string;
      devNotEnforced: string;
      remaining: string;
      upgraded: string;
      proTitle: string;
      proBody: string;
      onProPlan: string;
      freeTierNote: string;
      fetchEmpty: string;
      fetchParse: string;
      fetchFailed: string;
      resources: {
        videoDispatch: string;
        planPreview: string;
        blobUploadBytes: string;
        seedanceSegment: string;
      };
    };
    creative: {
      promptLabel: string;
      promptPlaceholderBusiness: string;
      promptPlaceholderPersonal: string;
      attachmentsLabel: string;
      durationLabel: string;
      aspectLabel: string;
      aspect916: string;
      aspect169: string;
      aspect11: string;
      endingLabel: string;
      endingAuto: string;
      endingUploaded: string;
      endingNone: string;
      ctaLabel: string;
      ctaPlaceholder: string;
      brandNameLabel: string;
      brandNamePlaceholder: string;
      websiteLabel: string;
      websitePlaceholder: string;
      previewPlan: string;
      generateVideo: string;
      generating: string;
      quickGenerate: string;
      quickHint: string;
      togglePlanShow: string;
      togglePlanHide: string;
      refreshPlan: string;
      prefilledVariant: string;
      prefilledLast: string;
      useLastPrompt: string;
      pageTitleBusiness: string;
      pageSubtitleBusiness: string;
      pageTitlePersonal: string;
      pageSubtitlePersonal: string;
      errPreviewPersonal: string;
      errPreviewBusiness: string;
      errDispatchPersonal: string;
      errDispatchBusiness: string;
      planBlockerPersonal: string;
      planBlockerBusiness: string;
    };
    integrations: {
      kicker: string;
      title: string;
      subtitle: string;
      metricsTitle: string;
      metricsSubtitle: string;
      footer: string;
      tiktokDesc: string;
      shopifyDesc: string;
      metaDesc: string;
      statusSelfServe: string;
    };
    studio: {
      kicker: string;
      title: string;
      subtitle: string;
      quickActions: string;
      newFromScratch: string;
      variantLatest: string;
      recentProducts: string;
      emptyRecent: string;
      hookPrefix: string;
      view: string;
      newVariant: string;
    };
    productDetail: {
      kicker: string;
      backToProducts: string;
      variantCta: string;
      lastUpdated: string;
      progressRefreshHint: string;
      finalVideo: string;
      viewFinal: string;
      download: string;
      regenerate: string;
      linkPending: string;
      scenesTitle: string;
      scenesEmpty: string;
      sceneNoThumb: string;
      sceneIndex: string;
      sceneReady: string;
      sceneGenerating: string;
      sceneFailed: string;
      scenePending: string;
      failedTitle: string;
      failedBody: string;
      failedRegenerate: string;
    };
    videoActions: {
      refresh: string;
      retryFailed: string;
      refreshFailed: string;
      retryFailedMsg: string;
      retryStarted: string;
      networkError: string;
    };
    metricsForm: {
      empty: string;
      video: string;
      window: string;
      window12: string;
      window24: string;
      window48: string;
      tiktokUrl: string;
      tiktokPlaceholder: string;
      views: string;
      completion: string;
      retention3s: string;
      likes: string;
      comments: string;
      save: string;
      saving: string;
      saveSuccess: string;
      saveError: string;
    };
    productsPage: {
      kicker: string;
      title: string;
      subtitle: string;
      newAd: string;
      emptyTitle: string;
      emptyBody: string;
      emptyCta: string;
      linkPending: string;
      progressScenes: string;
      assembling: string;
      viewFinal: string;
      download: string;
      regenerate: string;
      viewProgress: string;
      retryFailed: string;
      regen: string;
      supportHint: string;
    };
    performancePage: {
      kicker: string;
      title: string;
      subtitle: string;
      videosSection: string;
      loadError: string;
    };
    statsCards: {
      totalVideos: string;
      ready: string;
      inProgress: string;
      withMetrics: string;
      totalViews: string;
      avgCompletion: string;
    };
    perfTable: {
      empty: string;
      createFirst: string;
      colVideo: string;
      colStatus: string;
      colViews: string;
      colCompletion: string;
      open: string;
    };
    recommendationsPage: {
      kicker: string;
      title: string;
      subtitle: string;
      loadError: string;
      empty: string;
      priorityHigh: string;
      priorityMedium: string;
      priorityLow: string;
    };
    rec: {
      firstAdTitle: string;
      firstAdBody: string;
      retryTitle: string;
      retryBody: string;
      metricsTitle: string;
      metricsBody: string;
      winningTitle: string;
      winningBodyHook: string;
      winningBodyGeneric: string;
      progressTitle: string;
      progressBody: string;
      angleTitle: string;
      angleBody: string;
      actionNewAd: string;
      actionViewProduct: string;
      actionIntegrations: string;
      actionStudio: string;
      actionProducts: string;
    };
    businessStatus: {
      planning: { label: string; short: string };
      generating: { label: string; short: string };
      assembling: { label: string; short: string };
      ready: { label: string; short: string };
      failed: { label: string; short: string };
    };
  };
  error: {
    generic: string;
    network: string;
    notFound: string;
    backToHome: string;
    notFoundCode: string;
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
