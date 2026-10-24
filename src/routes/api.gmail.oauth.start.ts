import { randomBytes } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { getGmailOAuthConfig, validateGmailTokenEncryptionKey } from "@/lib/gmail-oauth.server";

export const Route = createFileRoute("/api/gmail/oauth/start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          validateGmailTokenEncryptionKey();
          const config = getGmailOAuthConfig();
          const state = randomBytes(32).toString("base64url");
          const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
          authUrl.search = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: "code",
            scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
            access_type: "offline",
            prompt: "consent",
            state,
          }).toString();
          const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
          return new Response(null, {
            status: 302,
            headers: {
              location: authUrl.toString(),
              "set-cookie": `guestpilot_gmail_state=${state}; HttpOnly; SameSite=Lax; Path=/api/gmail/oauth; Max-Age=600${secure}`,
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Unable to start Gmail authorization.",
            },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
