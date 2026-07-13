import path from "node:path";
import { expect, test } from "./framework";

test("产品图生成与优化可分别进入单条和批量视频", async ({ page }) => {
  await page.goto("/app/create/images");
  await expect(page.getByRole("heading", { name: "先把产品图做准，再批量出片" })).toBeVisible();

  await page.getByRole("button", { name: "生成产品图", exact: true }).click();
  await page.getByTestId("product-image-prompt").fill(
    "一只无品牌的哑光黑色保温杯，旋盖和金属杯口清晰，产品结构真实，白底电商棚拍。",
  );
  const generatedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/product-images") && response.request().method() === "POST",
  );
  await page.getByTestId("product-image-submit").click();
  expect((await generatedResponse).status()).toBe(201);
  await expect(page.getByTestId("product-image-result")).toBeVisible();
  await expect(page.getByText("AI Generated · Aivora")).toBeVisible();

  await page.getByRole("link", { name: /用于单条视频/ }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/app/create" && url.searchParams.has("productImageJobId"));
  await expect(page.getByText(/已从产品图工作台载入/)).toBeVisible();
  await expect(page.getByText(/Aivora-product-image-/)).toBeVisible();

  await page.goto("/app/create/images");
  await page.getByRole("button", { name: "优化实拍图", exact: true }).click();
  await page.getByTestId("product-image-source").setInputFiles(
    path.resolve(process.cwd(), "public/template-previews/white-studio-standard.jpg"),
  );
  await page.getByTestId("product-image-prompt").fill(
    "保持产品结构、颜色和所有包装细节完全一致，清理背景并改成柔和的白底棚拍，保留真实阴影。",
  );
  const optimizedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/product-images") && response.request().method() === "POST",
  );
  await page.getByTestId("product-image-submit").click();
  expect((await optimizedResponse).status()).toBe(201);
  await expect(page.getByTestId("product-image-result")).toBeVisible();

  await page.getByRole("link", { name: /用于批量视频/ }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/app/batches/new" && url.searchParams.has("productImageJobId"));
  await expect(page.getByText("1/50 张")).toBeVisible();
  await expect(page.getByText(/已完成 1/)).toBeVisible();
});
