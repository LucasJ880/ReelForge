import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { middleware } from "../src/middleware";

const SECRET = "middleware-cookie-regression-secret";

async function signedSessionToken() {
  return encode({
    secret: SECRET,
    token: {
      sub: "middleware-cookie-user",
      email: "middleware-cookie@example.test",
    },
  });
}

async function protectedRequest(cookieName: string, token: string, origin: string) {
  const request = new NextRequest(`${origin}/app/create`, {
    headers: {
      cookie: `${cookieName}=${token}`,
    },
  });

  return middleware(request);
}

test("middleware follows NextAuth cookie security rules for HTTP and HTTPS", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousNextAuthUrl = process.env.NEXTAUTH_URL;
  const previousVercel = process.env.VERCEL;

  process.env.AUTH_SECRET = SECRET;

  try {
    const token = await signedSessionToken();

    // A production build can still be served over local HTTP by `next start`.
    // An explicit HTTP NEXTAUTH_URL makes NextAuth issue the unprefixed cookie,
    // even when VERCEL is present, so middleware must accept the same cookie.
    process.env.NEXTAUTH_URL = "http://localhost:3120";
    process.env.VERCEL = "1";

    const localResponse = await protectedRequest(
      "next-auth.session-token",
      token,
      "http://localhost:3120",
    );
    assert.equal(localResponse.status, 200);
    assert.equal(localResponse.headers.get("x-middleware-next"), "1");

    const wrongLocalCookie = await protectedRequest(
      "__Secure-next-auth.session-token",
      token,
      "http://localhost:3120",
    );
    assert.equal(wrongLocalCookie.status, 307);
    assert.equal(
      new URL(assertNonNull(wrongLocalCookie.headers.get("location"))).pathname,
      "/login",
    );

    // On HTTPS, NextAuth uses the __Secure- prefix and middleware must not
    // silently accept the non-secure cookie name.
    process.env.NEXTAUTH_URL = "https://app.aivora.example";

    const productionResponse = await protectedRequest(
      "__Secure-next-auth.session-token",
      token,
      "https://app.aivora.example",
    );
    assert.equal(productionResponse.status, 200);
    assert.equal(productionResponse.headers.get("x-middleware-next"), "1");

    const insecureProductionCookie = await protectedRequest(
      "next-auth.session-token",
      token,
      "https://app.aivora.example",
    );
    assert.equal(insecureProductionCookie.status, 307);
    assert.equal(
      new URL(assertNonNull(insecureProductionCookie.headers.get("location"))).pathname,
      "/login",
    );
  } finally {
    restoreEnvironment("AUTH_SECRET", previousAuthSecret);
    restoreEnvironment("NEXTAUTH_URL", previousNextAuthUrl);
    restoreEnvironment("VERCEL", previousVercel);
  }
});

function assertNonNull(value: string | null): string {
  if (value === null) {
    assert.fail("expected response header to be present");
  }
  return value;
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
