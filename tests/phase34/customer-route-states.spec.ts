import { expect, test, type Page } from "@playwright/test";

const QA_HEADER = "x-aivora-qa-route-state";

const routes = [
  { id: "create", path: "/app/create", empty: "selector" },
  { id: "batches", path: "/app/batches", empty: "selector" },
  { id: "batchDetail", path: "/app/batches/rf012-missing", empty: "notFound" },
  { id: "racing", path: "/app/racing", empty: "selector" },
  { id: "library", path: "/app/library", empty: "selector" },
  { id: "templates", path: "/app/templates", empty: "selector" },
] as const;

async function installRouteStateInterception(page: Page, routeId: string) {
  let state: "slow" | "empty" | "error" = "slow";
  await page.route("**/*", async (route) => {
    const headers = {
      ...route.request().headers(),
      [QA_HEADER]: `${routeId}:${state}`,
    };
    await route.continue({ headers });
  });
  return (nextState: typeof state) => {
    state = nextState;
  };
}

for (const target of routes) {
  test(`RF-012 ${target.id} distinguishes slow, empty, and service failure`, async ({ page }) => {
    const setState = await installRouteStateInterception(page, target.id);

    setState("slow");
    await page.goto(target.path, { waitUntil: "commit" });
    await expect(page.locator('[data-route-state="loading"]')).toBeVisible();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator('[data-route-state="loading"]')).toHaveCount(0);

    setState("empty");
    await page.goto(target.path);
    if (target.empty === "notFound") {
      await expect(page.getByText("404 · Not Found", { exact: true })).toBeVisible();
    } else {
      await expect(page.locator('[data-route-state="empty"]')).toBeVisible();
    }
    await expect(page.locator('[data-route-state="error"]')).toHaveCount(0);

    setState("error");
    await page.goto(target.path);
    const errorState = page.locator('[data-route-state="error"]');
    await expect(errorState).toBeVisible();
    await expect(errorState).toContainText(/服务故障|service failure/i);
    await expect(errorState.getByRole("button", { name: /重试|try again/i })).toBeVisible();
    await expect(page.locator('[data-route-state="empty"]')).toHaveCount(0);
  });
}
