import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import {
  encryptRefreshToken,
  getGmailOAuthConfig,
  validateGmailTokenEncryptionKey,
} from "@/lib/gmail-oauth.server";

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function sameState(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function completeResponse(request: Request, status: "connected" | "error") {
  let origin = "http://localhost";
  try {
    const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
    if (redirectUri) origin = new URL(redirectUri).origin;
  } catch {
    console.error("[Gmail OAuth] Invalid GMAIL_OAUTH_REDIRECT_URI");
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      location: `${origin}/?gmail=${status}`,
      "set-cookie": `guestpilot_gmail_state=; HttpOnly; SameSite=Lax; Path=/api/gmail/oauth; Max-Age=0${secure}`,
      "cache-control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/gmail/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const callbackUrl = new URL(request.url);
        const returnedState = callbackUrl.searchParams.get("state");
        const savedState = cookieValue(request, "guestpilot_gmail_state");
        if (!returnedState || !savedState || !sameState(savedState, returnedState)) {
          return completeResponse(request, "error");
        }
        if (callbackUrl.searchParams.has("error") || !callbackUrl.searchParams.get("code")) {
          return completeResponse(request, "error");
        }

        try {
          validateGmailTokenEncryptionKey();
          const config = getGmailOAuthConfig();
          const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code: callbackUrl.searchParams.get("code")!,
              client_id: config.clientId,
              client_secret: config.clientSecret,
              redirect_uri: config.redirectUri,
              grant_type: "authorization_code",
            }),
          });
          const token = (await tokenResponse.json()) as {
            access_token?: string;
            refresh_token?: string;
            error?: string;
          };
          if (!tokenResponse.ok || !token.access_token) {
            throw new Error(
              `Google token exchange failed: ${token.error ?? tokenResponse.statusText}`,
            );
          }
          if (!token.refresh_token) {
            throw new Error("Google did not return a refresh token; revoke the app and reconnect.");
          }

          const profileResponse = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            { headers: { authorization: `Bearer ${token.access_token}` } },
          );
          const profile = (await profileResponse.json()) as { emailAddress?: string };
          if (!profileResponse.ok || !profile.emailAddress) {
            throw new Error("Google did not return the authorized Gmail address.");
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("gmail_connections").upsert({
            id: "primary",
            email: profile.emailAddress,
            ...encryptRefreshToken(token.refresh_token),
            connected_at: new Date().toISOString(),
          });
          if (error) throw new Error(`Unable to save encrypted Gmail connection: ${error.message}`);
          return completeResponse(request, "connected");
        } catch (error) {
          console.error(
            "[Gmail OAuth]",
            error instanceof Error ? error.message : "Authorization failed",
          );
          return completeResponse(request, "error");
        }
      },
    },
  },
});
