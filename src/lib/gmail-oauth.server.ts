import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

type GmailConnection = {
  email: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
};

function oauthConfig() {
  const { GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REDIRECT_URI } =
    process.env;
  if (!GMAIL_OAUTH_CLIENT_ID || !GMAIL_OAUTH_CLIENT_SECRET || !GMAIL_OAUTH_REDIRECT_URI) {
    throw new Error(
      "Gmail OAuth is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and GMAIL_OAUTH_REDIRECT_URI.",
    );
  }
  return {
    clientId: GMAIL_OAUTH_CLIENT_ID,
    clientSecret: GMAIL_OAUTH_CLIENT_SECRET,
    redirectUri: GMAIL_OAUTH_REDIRECT_URI,
  };
}

function encryptionKey(): Buffer {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function validateGmailTokenEncryptionKey() {
  encryptionKey();
}

export function encryptRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    refresh_token_ciphertext: ciphertext.toString("base64"),
    refresh_token_iv: iv.toString("base64"),
    refresh_token_tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptRefreshToken(connection: GmailConnection): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(connection.refresh_token_iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(connection.refresh_token_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(connection.refresh_token_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function getConnection(): Promise<GmailConnection> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("gmail_connections")
    .select("email,refresh_token_ciphertext,refresh_token_iv,refresh_token_tag")
    .eq("id", "primary")
    .maybeSingle();
  if (error) throw new Error(`Unable to read Gmail connection: ${error.message}`);
  if (!data) throw new Error("Connect Gmail before requesting an email verification code.");
  return data;
}

export async function revokeGmailAuthorization(): Promise<void> {
  const connection = await getConnection();
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: decryptRefreshToken(connection) }),
  });
  if (response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_token") return;
  }
  if (!response.ok) {
    throw new Error(`Google token revocation failed (${response.status}).`);
  }
}

async function accessToken(connection: GmailConnection): Promise<string> {
  const config = oauthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptRefreshToken(connection),
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Gmail token refresh failed: ${payload.error ?? response.statusText}`);
  }
  return payload.access_token;
}

function decodeMessagePart(part: {
  body?: { data?: string };
  parts?: Array<{ body?: { data?: string }; parts?: unknown[] }>;
}): string {
  const own = part.body?.data
    ? Buffer.from(part.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    : "";
  const nested = (part.parts ?? [])
    .map((child) => decodeMessagePart(child as Parameters<typeof decodeMessagePart>[0]))
    .join("\n");
  return `${own}\n${nested}`;
}

export function extractUniqueOtp(text: string): string | null {
  const matches = new Set<string>();
  const pattern =
    /(?:verification|security|one[-\s]?time|otp|passcode|code)[^\d]{0,30}(\d{4,8})|(\d{4,8})[^\w]{0,12}(?:is your|as your|for your)?[^\w]{0,8}(?:verification|security|one[-\s]?time|otp|passcode)/gi;
  for (const match of text.matchAll(pattern)) {
    const code = match[1] ?? match[2];
    if (code) matches.add(code);
  }
  return matches.size === 1 ? [...matches][0]! : null;
}

/** Server-only helper for an explicitly authorized publisher's recent verification email. */
export async function findRecentGmailOtp(domain: string): Promise<string | null> {
  const normalizedDomain = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalizedDomain)) {
    throw new Error("OTP lookup requires a valid publisher domain.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: approval, error: approvalError } = await supabaseAdmin
    .from("publisher_allowlist")
    .select("domain")
    .eq("domain", normalizedDomain)
    .eq("enabled", true)
    .maybeSingle();
  if (approvalError)
    throw new Error(`Unable to verify publisher approval: ${approvalError.message}`);
  if (!approval) throw new Error("OTP lookup is limited to publishers you explicitly approved.");

  const connection = await getConnection();
  const token = await accessToken(connection);
  const query = new URLSearchParams({
    q: `newer_than:15m from:${normalizedDomain}`,
    maxResults: "10",
  });
  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!listResponse.ok) throw new Error(`Gmail message search failed (${listResponse.status}).`);
  const list = (await listResponse.json()) as { messages?: Array<{ id: string }> };
  const candidateTexts: string[] = [];
  for (const message of list.messages ?? []) {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok)
      throw new Error(`Unable to read a matching Gmail message (${response.status}).`);
    const detail = (await response.json()) as {
      internalDate?: string;
      payload?: Parameters<typeof decodeMessagePart>[0];
    };
    if (detail.internalDate && Date.now() - Number(detail.internalDate) > 15 * 60_000) continue;
    const text = detail.payload ? decodeMessagePart(detail.payload) : "";
    candidateTexts.push(text);
  }
  return extractUniqueOtp(candidateTexts.join("\n"));
}

export function getGmailOAuthConfig() {
  return oauthConfig();
}
