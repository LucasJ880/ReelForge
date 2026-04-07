import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (error || !code) {
    const msg = searchParams.get("error_description") || error || "授权失败";
    return NextResponse.redirect(`${baseUrl}/settings?tiktok_error=${encodeURIComponent(msg)}`);
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY!;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET!;
  const redirectUri = `${baseUrl}/api/auth/tiktok/callback`;

  try {
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error?.code !== "ok" && !tokenData.access_token) {
      const msg = tokenData.error?.message || tokenData.error_description || "获取 Token 失败";
      console.error("[tiktok:oauth] Token exchange failed:", tokenData);
      return NextResponse.redirect(`${baseUrl}/settings?tiktok_error=${encodeURIComponent(msg)}`);
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 86400;
    const openId = tokenData.open_id;

    let displayName: string | null = null;
    let avatarUrl: string | null = null;

    try {
      const userRes = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      const userData = await userRes.json();
      displayName = userData.data?.user?.display_name || null;
      avatarUrl = userData.data?.user?.avatar_url || null;
    } catch {
      console.warn("[tiktok:oauth] Failed to fetch user info, continuing without it");
    }

    await db.tikTokAccount.upsert({
      where: { openId },
      create: {
        openId,
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        displayName,
        avatarUrl,
      },
      update: {
        accessToken,
        refreshToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        displayName,
        avatarUrl,
      },
    });

    return NextResponse.redirect(`${baseUrl}/settings?tiktok_connected=true`);
  } catch (err) {
    console.error("[tiktok:oauth] Callback error:", err);
    return NextResponse.redirect(`${baseUrl}/settings?tiktok_error=${encodeURIComponent("TikTok 授权过程出错")}`);
  }
}
