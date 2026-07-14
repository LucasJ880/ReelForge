import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getPlatformCopy } from "../src/i18n/platform-copy";
import { VideoDownloadLink, getCustomerDownloadUrl } from "../src/components/library/video-download-link";

const VIDEO_URL = "https://aivora.public.blob.vercel-storage.com/final/video.mp4?version=7";

test("成品下载 URL 保留已有参数并请求 Vercel Blob attachment 响应", () => {
  const downloadUrl = new URL(getCustomerDownloadUrl(VIDEO_URL));

  assert.equal(downloadUrl.origin, "https://aivora.public.blob.vercel-storage.com");
  assert.equal(downloadUrl.pathname, "/final/video.mp4");
  assert.equal(downloadUrl.searchParams.get("version"), "7");
  assert.equal(downloadUrl.searchParams.get("download"), "1");
});

test("成品下载动作按当前语言渲染且 href 使用下载 URL", () => {
  for (const [locale, expectedLabel] of [
    ["zh-CN", "下载成片"],
    ["en-US", "Download video"],
  ] as const) {
    const label = getPlatformCopy(locale).library.download;
    const html = renderToStaticMarkup(
      React.createElement(VideoDownloadLink, {
        videoUrl: VIDEO_URL,
        filename: "aivora-final-123.mp4",
        label,
      }),
    );

    assert.equal(label, expectedLabel);
    assert.match(html, /href="https:\/\/aivora\.public\.blob\.vercel-storage\.com\/final\/video\.mp4\?version=7&amp;download=1"/);
    assert.match(html, /download="aivora-final-123\.mp4"/);
    assert.match(html, new RegExp(`>${expectedLabel.replace(" ", "\\s*")}<`));
  }
});
