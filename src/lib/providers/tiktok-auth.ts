import { db } from "@/lib/db";

export interface TikTokTokens {
  accessToken: string;
  openId: string;
}

/**
 * 获取当前绑定的 TikTok 账号，自动刷新过期 token
 */
export async function getActiveTikTokAccount(): Promise<TikTokTokens | null> {
  const account = await db.tikTokAccount.findFirst({
    orderBy: { updatedAt: "desc" },
  });

  if (!account) return null;

  if (account.tokenExpiresAt < new Date()) {
    const refreshed = await refreshAccessToken(account.openId, account.refreshToken);
    if (!refreshed) return null;
    return refreshed;
  }

  return {
    accessToken: account.accessToken,
    openId: account.openId,
  };
}

async function refreshAccessToken(
  openId: string,
  refreshToken: string
): Promise<TikTokTokens | null> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) return null;

  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = await res.json();

    if (!data.access_token) {
      console.error("[tiktok:auth] Token refresh failed:", data);
      return null;
    }

    await db.tikTokAccount.update({
      where: { openId },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        tokenExpiresAt: new Date(Date.now() + (data.expires_in || 86400) * 1000),
      },
    });

    return {
      accessToken: data.access_token,
      openId,
    };
  } catch (err) {
    console.error("[tiktok:auth] Token refresh error:", err);
    return null;
  }
}
