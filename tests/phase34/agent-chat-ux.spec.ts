import { expect, test } from "@playwright/test";

test("RF-038: agent thread scrolls inside its viewport and keeps production CTA discoverable", async ({ page }) => {
  await page.route("**/api/personal/agent-chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        reply: "已记录。继续补充受众、使用场景与最重要的产品证明，我会把它整理进同一份生产简报。",
        readyToGenerate: false,
      }),
    });
  });

  await page.goto("/app/create");
  const transcript = page.getByTestId("agent-chat-scroll");
  const composer = page.getByTestId("agent-chat-composer");
  const prompt = composer.getByLabel("告诉导演你想做什么");
  const send = composer.getByRole("button", { name: "发送", exact: true });

  await expect(transcript).toBeVisible();
  await expect(composer).toBeVisible();
  const composerBefore = await composer.boundingBox();

  for (let index = 0; index < 9; index += 1) {
    await prompt.fill(`第 ${index + 1} 条产品信息：年轻用户、真实生活场景、保持同一产品外观。`);
    await send.click();
    await expect(prompt).toHaveValue("");
  }

  const dimensions = await transcript.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollTop).toBeGreaterThan(0);

  const composerAfter = await composer.boundingBox();
  expect(composerAfter?.y).toBeCloseTo(composerBefore?.y ?? 0, 0);

  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "跳到最新消息" })).toBeVisible();

  const generationButton = page.locator("#platform-primary-generate");
  await expect(generationButton).toHaveCount(1);
  await expect(generationButton).toBeVisible();
  await expect(generationButton).toBeEnabled();
});
