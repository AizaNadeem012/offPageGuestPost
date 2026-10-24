/**
 * gmail-imap.server.ts
 *
 * Connects directly to Gmail via IMAP over TLS (port 993) using the
 * GMAIL_SENDER_EMAIL and GMAIL_APP_PASSWORD from .env.
 * Automatically retrieves recent OTP / verification codes during
 * automated logins and guest post submissions.
 */

import tls from "node:tls";

function getCredentials() {
  const email = (process.env.GMAIL_SENDER_EMAIL ?? "").trim();
  const password = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "").trim();
  return { email, password };
}

export function extractOtpFromText(text: string): string | null {
  // Strip IMAP byte literals like {1234}
  const clean = text.replace(/\{\d+\}/g, " ");

  const patterns = [
    /(?:verification|security|one[-\s]?time|otp|passcode|confirmation|login)[^\d\r\n]{0,35}(\d{4,8})\b/i,
    /\b(\d{4,8})\b[^\w\r\n]{0,20}(?:is your|as your|for your|to verify|verification)/i,
    /(?:code|pin)[^\d\r\n]{0,20}:?\s*(\d{4,8})\b/i,
    /\byour\s+code\s+is\s+(\d{4,8})\b/i,
  ];

  for (const p of patterns) {
    const m = clean.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Searches the user's Gmail inbox via IMAP for a recently arrived OTP.
 */
export async function fetchRecentGmailOtp(domain?: string): Promise<string | null> {
  const { email, password } = getCredentials();
  if (!email || !password) {
    return null;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (val: string | null) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    const timeout = setTimeout(() => {
      safeResolve(null);
      try { client.end(); } catch {}
    }, 10000);

    const client = tls.connect(993, "imap.gmail.com", { rejectUnauthorized: false }, () => {});

    let step = 0;
    let buffer = "";
    let totalExists = 0;

    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      if (step === 0 && buffer.includes("* OK")) {
        step = 1;
        buffer = "";
        client.write(`A1 LOGIN "${email}" "${password}"\r\n`);
      } else if (step === 1 && buffer.includes("A1 OK")) {
        step = 2;
        buffer = "";
        client.write("A2 SELECT INBOX\r\n");
      } else if (step === 1 && (buffer.includes("A1 NO") || buffer.includes("A1 BAD"))) {
        clearTimeout(timeout);
        safeResolve(null);
        client.end();
      } else if (step === 2 && buffer.includes("A2 OK")) {
        const existsMatch = buffer.match(/\*\s+(\d+)\s+EXISTS/i);
        totalExists = existsMatch ? parseInt(existsMatch[1], 10) : 0;
        if (totalExists <= 0) {
          clearTimeout(timeout);
          safeResolve(null);
          client.write("A3 LOGOUT\r\n");
          return;
        }

        // Fetch the newest 3 messages directly using sequence numbers (fastest, no massive search list)
        const start = Math.max(1, totalExists - 2);
        step = 3;
        buffer = "";
        client.write(`A3 FETCH ${start}:${totalExists} (BODY[HEADER.FIELDS (SUBJECT FROM DATE)] BODY[TEXT])\r\n`);
      } else if (step === 3 && buffer.includes("A3 OK")) {
        clearTimeout(timeout);
        const otp = extractOtpFromText(buffer);
        safeResolve(otp);
        client.write("A4 LOGOUT\r\n");
        setTimeout(() => client.end(), 200);
      }
    });

    client.on("error", () => {
      clearTimeout(timeout);
      safeResolve(null);
    });

    client.on("close", () => {
      clearTimeout(timeout);
      safeResolve(null);
    });
  });
}
