import { encode } from "next-auth/jwt";
import { expect, test, type Page } from "@playwright/test";
import { db } from "../../src/lib/db";

type Role = "SUPER_ADMIN" | "OPERATOR" | "REVIEWER" | "CUSTOMER";
type UserType = "BUSINESS" | "PERSONAL" | "OPERATOR" | "SUPER_ADMIN" | null;

async function seedMatrixSession(page: Page, role: Role, userType: UserType) {
  expect(process.env.AUTH_SECRET).toBeTruthy();
  const customer = role === "CUSTOMER"
    ? await db.adminUser.findFirst({
        where: { role: "CUSTOMER", workspace: { isNot: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, name: true },
      })
    : null;
  if (role === "CUSTOMER") expect(customer, "RF-008 needs a seeded customer workspace").toBeTruthy();
  const token = await encode({
    secret: process.env.AUTH_SECRET!,
    maxAge: 60 * 60,
    token: {
      id: customer?.id ?? `rf008-${role.toLowerCase()}`,
      email: customer?.email ?? `rf008-${role.toLowerCase()}@aivora.test`,
      name: customer?.name ?? "RF-008 matrix",
      role,
      userType,
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

test("RF-008 SUPER_ADMIN with legacy BUSINESS persona reaches internal operations", async ({ page }) => {
  await seedMatrixSession(page, "SUPER_ADMIN", "BUSINESS");
  await page.goto("/internal");
  await expect(page).toHaveURL((url) => url.pathname === "/internal/orders");
  await expect(page.getByRole("navigation", { name: "内部主导航" })).toBeVisible();
});

test("RF-008 customer role cannot enter internal with any stored persona", async ({ page }) => {
  for (const userType of ["BUSINESS", "PERSONAL", "OPERATOR", "SUPER_ADMIN"] as const) {
    await seedMatrixSession(page, "CUSTOMER", userType);
    await page.goto("/internal");
    await expect(page, `CUSTOMER + ${userType}`).toHaveURL(
      (url) => !url.pathname.startsWith("/internal"),
    );
  }
});
