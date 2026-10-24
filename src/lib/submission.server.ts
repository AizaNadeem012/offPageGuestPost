/**
 * submission.server.ts
 *
 * Handles automated guest-post form submission with:
 *  - Cookie-session login (username + password from env)
 *  - OTP retrieval from Gmail (via gmail-oauth.server.ts)
 *  - CAPTCHA detection → dashboard notification (action_required)
 *  - Form field auto-detection and population
 */

import { isPrivateHost } from "./guestpilot";
import { spawn } from "node:child_process";

/** Credentials stored in .env */
function getCreds() {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    username: (process.env as any)["GUEST_POST_USERNAME"] ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    password: (process.env as any)["GUEST_POST_PASSWORD"] ?? "",
  };
}

const BOT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Low-level HTTP helpers (cookie-jar aware)
// ---------------------------------------------------------------------------

export type CookieJar = Map<string, string>;

/** Parse Set-Cookie headers into a simple key→value jar. */
function collectCookies(headers: Headers, jar: CookieJar) {
  // Headers.getSetCookie() is supported in Node 18+
  const setCookie =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : (headers.get("set-cookie") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  for (const raw of setCookie) {
    const pair = raw.split(";")[0]?.trim() ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      jar.set(name, value);
    }
  }
}

/** Serialize cookie jar to Cookie header value. */
function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function assertPublicHttps(url: string) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol) || isPrivateHost(u.hostname))
    throw new Error("Blocked URL: " + url);
}

/** GET with cookie jar + redirect following (max 6 hops). */
async function cookieGet(
  url: string,
  jar: CookieJar,
  timeoutMs = 15_000,
): Promise<{ url: string; html: string; status: number }> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    assertPublicHttps(current);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": BOT_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookieHeader(jar),
        },
      });
    } finally {
      clearTimeout(t);
    }
    collectCookies(res.headers, jar);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    const html = await res.text();
    return { url: current, html, status: res.status };
  }
  throw new Error("Too many redirects");
}

/** POST form data with cookie jar + redirect following. */
async function cookiePost(
  url: string,
  body: URLSearchParams | FormData,
  jar: CookieJar,
  timeoutMs = 20_000,
): Promise<{ url: string; html: string; status: number }> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    assertPublicHttps(current);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      const isFormData = body instanceof FormData;
      res = await fetch(current, {
        method: "POST",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": BOT_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: cookieHeader(jar),
          ...(isFormData ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
          Referer: current,
        },
        body,
      });
    } finally {
      clearTimeout(t);
    }
    collectCookies(res.headers, jar);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      // After POST redirect, follow with GET
      current = new URL(res.headers.get("location")!, current).toString();
      const getResult = await cookieGet(current, jar, timeoutMs);
      return getResult;
    }
    const html = await res.text();
    return { url: current, html, status: res.status };
  }
  throw new Error("Too many redirects after POST");
}

// ---------------------------------------------------------------------------
// Form parsing helpers
// ---------------------------------------------------------------------------

/** Extract all <input>, <textarea>, <select> from an HTML form. */
function parseFormFields(html: string, formIndex = 0) {
  const formRe = /<form[\s\S]*?<\/form>/gi;
  const forms = [...html.matchAll(formRe)];
  const formHtml = forms[formIndex]?.[0] ?? html;

  const fields: Record<string, string> = {};

  // Hidden inputs (csrf, nonce, etc.)
  for (const m of formHtml.matchAll(/<input[^>]+type=["']?hidden["']?[^>]*>/gi)) {
    const name = m[0].match(/name=["']([^"']+)["']/i)?.[1];
    const value = m[0].match(/value=["']([^"']*)["']/i)?.[1] ?? "";
    if (name) fields[name] = value;
  }

  // Text/email/password inputs (for detection only — we will fill in our values)
  for (const m of formHtml.matchAll(/<input[^>]+>/gi)) {
    const type = m[0].match(/type=["']?([a-z-]+)["']?/i)?.[1]?.toLowerCase() ?? "text";
    if (["submit", "button", "image", "reset", "checkbox", "radio"].includes(type)) continue;
    const name = m[0].match(/name=["']([^"']+)["']/i)?.[1];
    if (name && !(name in fields)) fields[name] = "";
  }

  // Textareas
  for (const m of formHtml.matchAll(/<textarea[^>]*name=["']([^"']+)["'][^>]*>/gi)) {
    const name = m[1];
    if (name && !(name in fields)) fields[name] = "";
  }

  // Extract form action
  const action = formHtml.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1] ?? null;
  const method = (formHtml.match(/<form[^>]+method=["']([^"']+)["']/i)?.[1] ?? "POST").toUpperCase();

  return { fields, action, method };
}

/** Find which field name looks like a username/email field. */
function findUsernameField(fields: Record<string, string>): string | null {
  for (const key of Object.keys(fields)) {
    if (/user(name)?|email|log.?in|account/i.test(key)) return key;
  }
  return null;
}

/** Find which field name looks like a password field. */
function findPasswordField(html: string): string | null {
  const m = html.match(/<input[^>]+type=["']?password["']?[^>]*name=["']([^"']+)["']/i)
    ?? html.match(/<input[^>]+name=["']([^"']+)["'][^>]*type=["']?password["']?/i);
  return m?.[1] ?? null;
}

/** Find a field that looks like an OTP / verification code input. */
function findOtpField(html: string): string | null {
  const m = html.match(
    /<input[^>]+(name=["']([^"']+)["'][^>]*(otp|code|verif|token)|otp|code|verif|token[^>]*name=["']([^"']+)["'])[^>]*>/i,
  );
  if (m) return m[2] ?? m[4] ?? null;
  // fallback: any input whose name contains otp/code/verif
  for (const im of html.matchAll(/<input[^>]+>/gi)) {
    const name = im[0].match(/name=["']([^"']+)["']/i)?.[1];
    if (name && /otp|code|verif|token|pin/i.test(name)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export type LoginResult =
  | { success: true; jar: CookieJar; landingUrl: string }
  | { success: false; reason: string };

/**
 * Try to log in to a site's login page.
 * Returns a cookie jar that can be used for subsequent requests.
 */
export async function loginToSite(loginUrl: string, domain: string): Promise<LoginResult> {
  const { username, password } = getCreds();
  if (!username || !password) {
    return { success: false, reason: "GUEST_POST_USERNAME / GUEST_POST_PASSWORD not set in .env" };
  }

  const jar: CookieJar = new Map();

  // 1. GET the login page to collect CSRF tokens / cookies
  let loginPage: { url: string; html: string; status: number };
  try {
    loginPage = await cookieGet(loginUrl, jar);
  } catch (e) {
    return { success: false, reason: `Could not load login page: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (loginPage.status >= 400) {
    return { success: false, reason: `Login page returned HTTP ${loginPage.status}` };
  }

  // 2. Parse login form
  const { fields, action, method } = parseFormFields(loginPage.html);
  const usernameField = findUsernameField(fields) ?? "username";
  const passwordField = findPasswordField(loginPage.html) ?? "password";

  const formAction = action
    ? new URL(action, loginPage.url).toString()
    : loginPage.url;

  // 3. Fill in credentials
  const postBody = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    postBody.set(k, v); // hidden fields (CSRF etc.)
  }
  postBody.set(usernameField, username);
  postBody.set(passwordField, password);

  // 4. Submit the login form
  let afterLogin: { url: string; html: string; status: number };
  try {
    if (method === "POST") {
      afterLogin = await cookiePost(formAction, postBody, jar);
    } else {
      const getUrl = new URL(formAction);
      postBody.forEach((v, k) => getUrl.searchParams.set(k, v));
      afterLogin = await cookieGet(getUrl.toString(), jar);
    }
  } catch (e) {
    return { success: false, reason: `Login POST failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 5. Check if an OTP step appeared
  const otpField = findOtpField(afterLogin.html);
  if (otpField) {
    // Try to fetch OTP from Gmail
    const otp = await tryGetOtp(domain);
    if (!otp) {
      return {
        success: false,
        reason: "OTP / verification code required — no matching email found in Gmail inbox",
      };
    }

    // Submit OTP form
    const { fields: otpFields, action: otpAction } = parseFormFields(afterLogin.html);
    const otpBody = new URLSearchParams();
    for (const [k, v] of Object.entries(otpFields)) otpBody.set(k, v);
    otpBody.set(otpField, otp);
    const otpFormAction = otpAction
      ? new URL(otpAction, afterLogin.url).toString()
      : afterLogin.url;

    try {
      afterLogin = await cookiePost(otpFormAction, otpBody, jar);
    } catch (e) {
      return { success: false, reason: `OTP submission failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // 6. Heuristic: logged-in pages typically don't contain a login form anymore
  const stillHasLoginForm =
    /type=["']?password["']?/i.test(afterLogin.html) &&
    /log.?in|sign.?in/i.test(afterLogin.html.slice(0, 2000));

  if (stillHasLoginForm) {
    return {
      success: false,
      reason: "Login did not succeed — credentials may be wrong or site uses unsupported auth flow",
    };
  }

  return { success: true, jar, landingUrl: afterLogin.url };
}

// ---------------------------------------------------------------------------
// OTP helper (wraps gmail-oauth.server)
// ---------------------------------------------------------------------------

async function tryGetOtp(domain: string): Promise<string | null> {
  // 1. Direct Gmail IMAP lookup using user's configured email & app password
  try {
    const { fetchRecentGmailOtp } = await import("./gmail-imap.server");
    const otp = await fetchRecentGmailOtp(domain);
    if (otp) return otp;
  } catch {
    /* fallback to oauth */
  }

  // 2. Fallback to Gmail OAuth if connected
  try {
    const { findRecentGmailOtp } = await import("./gmail-oauth.server");
    return await findRecentGmailOtp(domain);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Guest-post form submission
// ---------------------------------------------------------------------------

export type SubmissionResult =
  | { outcome: "submitted"; note: string; submissionUrl?: string }
  | { outcome: "captcha"; note: string }
  | { outcome: "login_failed"; note: string }
  | { outcome: "no_form"; note: string }
  | { outcome: "error"; note: string };

export async function submitViaBrowser(opts: {
  submissionUrl: string;
  loginUrl?: string | null;
  domain: string;
  article: {
    title: string;
    content: string;
    authorName?: string;
    authorEmail?: string;
    targetUrl?: string;
  };
}): Promise<SubmissionResult> {
  const creds = getCreds();
  const email = (opts.article.authorEmail || process.env.GMAIL_SENDER_EMAIL || "").trim();
  const gmailPassword = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "").trim();

  const payload = JSON.stringify({
    url: opts.submissionUrl,
    loginUrl: opts.loginUrl ?? null,
    domain: opts.domain,
    title: opts.article.title,
    content: opts.article.content,
    authorName: opts.article.authorName ?? "",
    targetUrl: opts.article.targetUrl ?? "",
    username: creds.username,
    email: email,
    password: creds.password,
    gmailPassword: gmailPassword,
  });

  return new Promise((resolve) => {
    const py = spawn("python", ["scripts/browser_submitter.py", payload], {
      windowsHide: true,
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });

    py.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    const timeout = setTimeout(() => {
      try { py.kill(); } catch {}
      resolve({
        outcome: "error",
        note: "Automated browser submission timed out (45s)",
      });
    }, 45_000);

    py.on("close", (code) => {
      clearTimeout(timeout);
      try {
        const lines = stdout.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        const res = JSON.parse(lastLine);
        if (res.outcome === "submitted" || res.success) {
          resolve({
            outcome: "submitted",
            note: res.note ?? `Published to ${opts.domain} via automated browser`,
            submissionUrl: res.publishedUrl ?? opts.submissionUrl,
          });
        } else if (res.outcome === "login_failed") {
          resolve({
            outcome: "login_failed",
            note: res.note ?? "Login failed during browser automation",
          });
        } else {
          resolve({
            outcome: "error",
            note: res.note ?? `Browser automation exited with status: ${code}`,
          });
        }
      } catch {
        resolve({
          outcome: "error",
          note: `Browser agent output: ${stderr || stdout || "Exited with code " + code}`,
        });
      }
    });

    py.on("error", (err) => {
      clearTimeout(timeout);
      resolve({
        outcome: "error",
        note: `Could not launch browser submitter: ${err.message}`,
      });
    });
  });
}

/**
 * Attempt to log in and submit a guest-post article via the site's submission form.
 *
 * @param submissionUrl  URL of the write-for-us / submission form page
 * @param loginUrl       URL of the login page (optional — if omitted, we visit submissionUrl directly)
 * @param domain         Bare domain (e.g. "example.com") used for OTP lookup & cookie scoping
 * @param article        The article to submit
 */
export async function submitGuestPost(opts: {
  submissionUrl: string;
  loginUrl: string | null;
  domain: string;
  article: {
    title: string;
    content: string;
    authorName?: string;
    authorEmail?: string;
  };
}): Promise<SubmissionResult> {
  const { submissionUrl, loginUrl, domain, article } = opts;

  // Forums & modern rich-text sites: prioritize headless browser automation
  if (domain.includes("forum.") || /forum|community|discuss/i.test(submissionUrl)) {
    return submitViaBrowser(opts);
  }

  const jar: CookieJar = new Map();

  // 1. Login (if a login URL is known)
  if (loginUrl) {
    const loginResult = await loginToSite(loginUrl, domain);
    if (!loginResult.success) {
      // Try browser login if HTTP login failed
      const browserTry = await submitViaBrowser(opts);
      if (browserTry.outcome === "submitted" || browserTry.outcome === "login_failed") {
        return browserTry;
      }
      return { outcome: "login_failed", note: loginResult.reason };
    }
    // Copy cookies from login session
    for (const [k, v] of loginResult.jar) jar.set(k, v);
  }

  // 2. Load the submission / write-for-us page
  let subPage: { url: string; html: string; status: number };
  try {
    subPage = await cookieGet(submissionUrl, jar);
  } catch (e) {
    const browserTry = await submitViaBrowser(opts);
    if (browserTry.outcome === "submitted") return browserTry;
    return { outcome: "error", note: `Could not load submission page: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (subPage.status >= 400) {
    const browserTry = await submitViaBrowser(opts);
    if (browserTry.outcome === "submitted" || browserTry.outcome === "login_failed") return browserTry;
    return { outcome: "error", note: `Submission page returned HTTP ${subPage.status}` };
  }

  // 3. CAPTCHA check on the submission page
  if (/g-recaptcha|hcaptcha|cf-turnstile|data-sitekey/i.test(subPage.html)) {
    const browserTry = await submitViaBrowser(opts);
    if (browserTry.outcome === "submitted" || browserTry.outcome === "login_failed") return browserTry;
    return {
      outcome: "captcha",
      note: "Submission page contains a CAPTCHA — manual intervention required",
    };
  }

  // 4. Find the submission form
  const hasForm = /<form[\s\S]*?<textarea/i.test(subPage.html);
  if (!hasForm) {
    const browserTry = await submitViaBrowser(opts);
    if (browserTry.outcome === "submitted" || browserTry.outcome === "login_failed") return browserTry;
    return { outcome: "no_form", note: "No submission form with a text area was found on this page" };
  }

  // 5. Parse the form
  const { fields, action, method } = parseFormFields(subPage.html);
  const formAction = action
    ? new URL(action, subPage.url).toString()
    : subPage.url;

  // 6. Map article fields onto form fields
  const postBody = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) postBody.set(k, v); // hidden/CSRF first

  const fieldMap: Record<string, string> = {};
  for (const key of Object.keys(fields)) {
    const lk = key.toLowerCase().replace(/[_-]/g, "");
    if (/title|headline|subject/.test(lk)) fieldMap["title"] = key;
    else if (/content|body|post|article|text|message/.test(lk)) fieldMap["content"] = key;
    else if (/name|author/.test(lk)) fieldMap["name"] = key;
    else if (/email|mail/.test(lk)) fieldMap["email"] = key;
  }

  if (fieldMap["title"]) postBody.set(fieldMap["title"], article.title);
  if (fieldMap["content"]) postBody.set(fieldMap["content"], article.content);
  if (fieldMap["name"] && article.authorName) postBody.set(fieldMap["name"], article.authorName);
  if (fieldMap["email"] && article.authorEmail) postBody.set(fieldMap["email"], article.authorEmail);

  // Fallback: if we couldn't identify a content field, abort
  if (!fieldMap["content"]) {
    return { outcome: "no_form", note: "Could not identify a content/article field in the form" };
  }

  // 7. Submit
  try {
    let afterSubmit: { url: string; html: string; status: number };
    if (method === "POST") {
      afterSubmit = await cookiePost(formAction, postBody, jar);
    } else {
      const getUrl = new URL(formAction);
      postBody.forEach((v, k) => getUrl.searchParams.set(k, v));
      afterSubmit = await cookieGet(getUrl.toString(), jar);
    }

    // 8. Success heuristic: look for thank-you / success keywords
    const successSignal =
      /thank.you|submission.received|submitted.successfully|your.article.has.been|post.received|we.will.review/i.test(
        afterSubmit.html,
      );
    const errorSignal =
      /error|invalid|required.field|please.fill/i.test(afterSubmit.html.slice(0, 3000));

    if (successSignal) {
      return { outcome: "submitted", note: `Successfully submitted to ${domain} (${afterSubmit.url})`, submissionUrl: afterSubmit.url };
    }
    if (errorSignal) {
      return { outcome: "error", note: `Form returned an error after submission — manual check needed at ${afterSubmit.url}` };
    }
    // Ambiguous — treat as submitted but note it
    return {
      outcome: "submitted",
      note: `Form submitted to ${domain} — no explicit success message detected; please verify at ${afterSubmit.url}`,
      submissionUrl: afterSubmit.url,
    };
  } catch (e) {
    return { outcome: "error", note: `Form submission failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
