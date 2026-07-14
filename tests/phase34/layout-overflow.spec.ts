import { encode } from "next-auth/jwt";
import { expect, test, type Page } from "@playwright/test";
import { db } from "../../src/lib/db";

const WIDTHS = [1280, 1440, 1920] as const;

async function expectNoViewportOverflow(page: Page, label: string) {
  const audit = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 1,
        };
      })
      .filter((entry) => entry.visible && (entry.left < -1 || entry.right > viewport + 1))
      .slice(0, 20);
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      offenders,
    };
  });
  expect(audit.documentWidth, `${label}: document width`).toBeLessThanOrEqual(audit.viewport + 1);
  expect(audit.offenders, `${label}: overflowing elements`).toEqual([]);
}

async function useInternalSession(page: Page) {
  const internalUser = await db.adminUser.findFirst({
    where: {
      role: { in: ["SUPER_ADMIN", "OPERATOR"] },
      userType: { in: ["SUPER_ADMIN", "OPERATOR"] },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, email: true, name: true, role: true, userType: true },
  });
  expect(internalUser, "RF-011 needs an internal rehearsal account").toBeTruthy();
  expect(process.env.AUTH_SECRET).toBeTruthy();
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    maxAge: 60 * 60,
    token: {
      id: internalUser!.id,
      email: internalUser!.email,
      name: internalUser!.name,
      role: internalUser!.role,
      userType: internalUser!.userType as
        | "BUSINESS"
        | "PERSONAL"
        | "OPERATOR"
        | "SUPER_ADMIN"
        | null,
    },
  });
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: "next-auth.session-token",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test("RF-011 template filters and card rows stay inside three desktop widths", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/app/templates");
    await expect(page.locator("[data-template-filters]")).toBeVisible();
    await expectNoViewportOverflow(page, `templates ${width}`);

    const rowHeights = await page.locator("[data-template-card]").evaluateAll((cards) => {
      const rows = new Map<number, number[]>();
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const top = Math.round(rect.top);
        rows.set(top, [...(rows.get(top) ?? []), Math.round(rect.height)]);
      }
      return [...rows.values()].filter((row) => row.length > 1);
    });
    expect(rowHeights.length).toBeGreaterThan(0);
    for (const heights of rowHeights) {
      expect(Math.max(...heights) - Math.min(...heights), `template card row ${width}`).toBeLessThanOrEqual(1);
    }
  }
});

test("RF-011 internal round actions stay inside three desktop widths", async ({ page }) => {
  await useInternalSession(page);
  const round = await db.round.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  expect(round, "RF-011 needs a seeded round").toBeTruthy();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/internal/rounds/${round!.id}`);
    await expect(page.locator("[data-round-actions]")).toBeVisible();
    await expectNoViewportOverflow(page, `internal round ${width}`);
  }
});
