/**
 * src/lib/verification.server.ts
 *
 * Strict, Evidence-Based Backlink Verification Engine
 *
 * Enforces mandatory verification rules:
 * - Rejects contact forms, logins, submission pages, search queries, guidelines, and homepages as publication evidence.
 * - Enforces SSRF protection (private IP / localhost / metadata blocked).
 * - Follows redirects safely and detects redirect loops.
 * - Re-evaluates canonical destination to ensure it does not redirect to a login/error page.
 * - Resolves relative URLs and normalizes link targets.
 * - Extracts actual anchor elements, rel tokens (dofollow, nofollow, sponsored, ugc), and anchor text.
 * - Returns structured verification results with explicit, truthful status and failure reasons.
 */

import { isPrivateHost } from "./guestpilot";
import { spawn } from "node:child_process";

export type VerificationStatus = "verified" | "pending" | "failed" | "blocked";

export interface BacklinkVerificationResult {
  status: VerificationStatus;
  publishedUrl: string;
  finalUrl: string;
  targetUrl: string;
  anchorText: string;
  httpStatus: number | null;
  relAttributes: string[];
  isNofollow: boolean;
  isSponsored: boolean;
  isUgc: boolean;
  isDofollow: boolean;
  linkFound: boolean;
  articleContentFound: boolean;
  verifiedAt: string | null;
  reason: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DISALLOWED_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  {
    regex: /(?:^|\/)(?:wp-)?login(?:\.php)?|\/sign-?in|\/sign-?up|\/register|\/auth|\/oauth/i,
    description: "authentication or registration URL",
  },
  {
    regex: /(?:^|\/)(?:contact|contact-us|contactus|get-in-touch|inquiry|feedback)(?:\/|$|\?|\.html|\.php)/i,
    description: "contact form URL",
  },
  {
    regex: /(?:^|\/)(?:write-for-us|guest-post-guidelines|guidelines|contribute|editorial-guidelines|content-guidelines|author-guidelines|submission-guidelines|submit-guest-post|submit-article|submit-post)(?:\/|$|\?)/i,
    description: "guest post guidelines or submission page",
  },
  {
    regex: /(?:\?|&)(?:s|q|search|query)=/i,
    description: "search query URL",
  },
  {
    regex: /(?:^|\/)(?:thank-you|submitted|submission-received|form-submitted|confirmation)(?:\/|$|\?)/i,
    description: "submission confirmation / receipt page",
  },
  {
    regex: /(?:jotform\.com|forms\.gle|typeform\.com|surveymonkey\.com|docs\.google\.com\/forms)/i,
    description: "third-party form or survey endpoint",
  },
  {
    regex: /\.(?:pdf|zip|rar|tar|gz|exe|dmg|iso|stl|obj|png|jpe?g|gif|svg|xml|rss|txt)$/i,
    description: "non-HTML asset file",
  },
];

/**
 * Validates candidate URL and rejects non-article URLs (login, contact, guidelines, receipts).
 */
export function validateCandidateUrl(rawUrl: string): { valid: boolean; reason?: string; url?: URL } {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, reason: "Candidate publication URL is empty" };
  }

  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, reason: "Invalid protocol: URL must begin with http:// or https://" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "Malformed URL syntax" };
  }

  if (isPrivateHost(parsed.hostname)) {
    return { valid: false, reason: `SSRF Blocked: Destination host "${parsed.hostname}" is a private or internal network address` };
  }

  // Check disallowed non-article patterns
  const pathAndQuery = parsed.pathname + parsed.search;
  for (const { regex, description } of DISALLOWED_PATTERNS) {
    if (regex.test(pathAndQuery) || regex.test(parsed.hostname)) {
      return {
        valid: false,
        reason: `Rejected: Candidate URL is a ${description}, not a published article (${pathAndQuery})`,
      };
    }
  }

  // Disallow bare root homepage (e.g. https://example.com/ or https://example.com) as an article URL
  if (parsed.pathname === "/" || parsed.pathname === "") {
    return { valid: false, reason: "Rejected: Candidate URL is a publisher homepage, not a specific published article" };
  }

  return { valid: true, url: parsed };
}

/**
 * Normalizes destination URL for accurate backlink matching.
 */
export function normalizeDestinationUrl(u: string): string {
  return u
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * Extracts anchor elements, resolving relative URLs and parsing rel attributes.
 */
export function extractAnchors(
  html: string,
  baseUrl: string,
): Array<{ href: string; resolvedHref: string; anchorText: string; rel: string[]; rawRel: string }> {
  const anchors: Array<{ href: string; resolvedHref: string; anchorText: string; rel: string[]; rawRel: string }> = [];
  const linkRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRegex.exec(html))) {
    const attrs = m[1] ?? "";
    const hrefMatch = attrs.match(/href\s*=\s*(?:["']([^"'#\s][^"']*)["']|([^\s"'#>]+))/i);
    const rawHref = (hrefMatch?.[1] || hrefMatch?.[2] || "").trim();
    if (!rawHref) continue;

    if (rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
      continue;
    }

    let resolvedHref = rawHref;
    try {
      resolvedHref = new URL(rawHref, baseUrl).toString();
    } catch {
      // Keep raw if resolution fails
    }

    const relMatch = attrs.match(/rel\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
    const rawRel = (relMatch?.[1] || relMatch?.[2] || "").toLowerCase().trim();
    const relTokens = rawRel ? rawRel.split(/\s+/).filter(Boolean) : [];

    const innerHtml = m[2] ?? "";
    const imgAlt = innerHtml.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    let anchorText = innerHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

    if (!anchorText && imgAlt) {
      anchorText = `[Image: ${imgAlt.trim()}]`;
    }

    anchors.push({
      href: rawHref,
      resolvedHref,
      anchorText,
      rel: relTokens,
      rawRel,
    });
  }

  return anchors;
}

/**
 * Safely fetches a URL, following redirects up to maxHops with SSRF checks.
 */
export async function safeFetchHtml(
  startUrl: string,
  maxHops = 6,
  timeoutMs = 15_000,
): Promise<{ finalUrl: string; status: number; html: string; error?: string }> {
  let current = startUrl;
  const visited = new Set<string>();

  for (let hop = 0; hop < maxHops; hop++) {
    const check = validateCandidateUrl(current);
    if (!check.valid) {
      return { finalUrl: current, status: 0, html: "", error: check.reason };
    }

    if (visited.has(current)) {
      return { finalUrl: current, status: 0, html: "", error: `Redirect loop detected: circular redirection back to ${current}` };
    }
    visited.add(current);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      return { finalUrl: current, status: 0, html: "", error: `Connection failed: ${msg}` };
    } finally {
      clearTimeout(timer);
    }

    // Follow redirect
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const loc = res.headers.get("location")!;
      try {
        current = new URL(loc, current).toString();
      } catch {
        return { finalUrl: current, status: res.status, html: "", error: `Invalid redirect location: ${loc}` };
      }
      continue;
    }

    // Final response reached
    const html = await res.text();
    return { finalUrl: current, status: res.status, html };
  }

  return { finalUrl: current, status: 0, html: "", error: "Redirect loop detected: exceeded 6 hops" };
}

/**
 * Uses headless Chrome with anti-detection stealth to inspect live rendered DOM,
 * bypassing Cloudflare Turnstile and rendering JavaScript-heavy Single-Page Applications (SPAs).
 */
export async function verifyViaBrowser(opts: {
  publishedUrl: string;
  targetUrl: string;
  expectedAnchorText?: string | null;
  expectedTitle?: string | null;
  timeoutMs?: number;
}): Promise<BacklinkVerificationResult | null> {
  const verifiedAt = new Date().toISOString();
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      publishedUrl: opts.publishedUrl,
      targetUrl: opts.targetUrl,
      expectedAnchorText: opts.expectedAnchorText ?? "",
      expectedTitle: opts.expectedTitle ?? "",
    });

    const py = spawn("python", ["scripts/browser_verifier.py", "-"], {
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

    const timer = setTimeout(() => {
      try {
        py.kill();
      } catch {}
      resolve(null);
    }, opts.timeoutMs ?? 35_000);

    py.on("close", () => {
      clearTimeout(timer);
      try {
        const lines = stdout.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        if (!lastLine) return resolve(null);
        const data = JSON.parse(lastLine);
        if (!data.success && data.blocked) {
          return resolve({
            status: "blocked",
            publishedUrl: opts.publishedUrl,
            finalUrl: data.finalUrl || opts.publishedUrl,
            targetUrl: opts.targetUrl,
            anchorText: "",
            httpStatus: 403,
            relAttributes: [],
            isNofollow: false,
            isSponsored: false,
            isUgc: false,
            isDofollow: false,
            linkFound: false,
            articleContentFound: false,
            verifiedAt,
            reason: data.reason || "Publisher Cloudflare challenge active and blocked automated verification",
          });
        }
        if (data.success && data.linkFound) {
          return resolve({
            status: "verified",
            publishedUrl: opts.publishedUrl,
            finalUrl: data.finalUrl || opts.publishedUrl,
            targetUrl: opts.targetUrl,
            anchorText: data.anchorText || "",
            httpStatus: 200,
            relAttributes: data.relAttributes || [],
            isNofollow: !!data.isNofollow,
            isSponsored: !!data.isSponsored,
            isUgc: !!data.isUgc,
            isDofollow: !!data.isDofollow,
            linkFound: true,
            articleContentFound: !!data.articleContentFound,
            verifiedAt,
            reason: data.reason || `Verified: Clickable hyperlink to ${opts.targetUrl} confirmed in rendered DOM`,
          });
        }
        if (data.success && !data.linkFound) {
          return resolve({
            status: "failed",
            publishedUrl: opts.publishedUrl,
            finalUrl: data.finalUrl || opts.publishedUrl,
            targetUrl: opts.targetUrl,
            anchorText: "",
            httpStatus: 200,
            relAttributes: [],
            isNofollow: false,
            isSponsored: false,
            isUgc: false,
            isDofollow: false,
            linkFound: false,
            articleContentFound: !!data.articleContentFound,
            verifiedAt,
            reason: data.reason || `Target link missing: No clickable link pointing to ${opts.targetUrl} found in rendered DOM`,
          });
        }
      } catch {
        resolve(null);
      }
      resolve(null);
    });

    py.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });

    try {
      py.stdin.write(payload);
      py.stdin.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Reusable Backlink Verification Service.
 *
 * Verifies that candidate publishedUrl points to a live public article containing
 * a clickable backlink to targetUrl.
 */
export async function verifyBacklink(opts: {
  publishedUrl: string;
  targetUrl: string;
  expectedAnchorText?: string | null;
  expectedTitle?: string | null;
  htmlOverride?: string; // used for unit tests and local fixtures
  timeoutMs?: number;
}): Promise<BacklinkVerificationResult> {
  const { publishedUrl, targetUrl, expectedAnchorText, expectedTitle, htmlOverride, timeoutMs } = opts;
  const verifiedAt = new Date().toISOString();

  // 1. Initial Candidate URL validation
  const validation = validateCandidateUrl(publishedUrl);
  if (!validation.valid) {
    return {
      status: "failed",
      publishedUrl,
      finalUrl: publishedUrl,
      targetUrl,
      anchorText: "",
      httpStatus: null,
      relAttributes: [],
      isNofollow: false,
      isSponsored: false,
      isUgc: false,
      isDofollow: false,
      linkFound: false,
      articleContentFound: false,
      verifiedAt,
      reason: validation.reason || "Candidate URL rejected by verification rules",
    };
  }

  // 2. Fetch page HTML and follow redirects safely
  let finalUrl = publishedUrl;
  let httpStatus: number | null = 200;
  let html = htmlOverride ?? "";

  if (htmlOverride === undefined) {
    const fetchRes = await safeFetchHtml(publishedUrl, 6, timeoutMs || 15_000);
    finalUrl = fetchRes.finalUrl;
    httpStatus = fetchRes.status;
    html = fetchRes.html;

    if (fetchRes.error) {
      const isBlocked = /blocked|cloudflare|access restricted|403|401/i.test(fetchRes.error);
      return {
        status: isBlocked ? "blocked" : "failed",
        publishedUrl,
        finalUrl,
        targetUrl,
        anchorText: "",
        httpStatus: httpStatus || null,
        relAttributes: [],
        isNofollow: false,
        isSponsored: false,
        isUgc: false,
        isDofollow: false,
        linkFound: false,
        articleContentFound: false,
        verifiedAt,
        reason: fetchRes.error,
      };
    }
  }

  // 3. Post-redirect destination check (Did redirect land on login/contact/error?)
  const finalValidation = validateCandidateUrl(finalUrl);
  if (!finalValidation.valid && htmlOverride === undefined) {
    return {
      status: "failed",
      publishedUrl,
      finalUrl,
      targetUrl,
      anchorText: "",
      httpStatus,
      relAttributes: [],
      isNofollow: false,
      isSponsored: false,
      isUgc: false,
      isDofollow: false,
      linkFound: false,
      articleContentFound: false,
      verifiedAt,
      reason: `Redirected to invalid destination: ${finalValidation.reason}`,
    };
  }

  // 4. HTTP status check
  if (httpStatus >= 400) {
    const isAccessBlocked = httpStatus === 403 || httpStatus === 401 || /cloudflare|just a moment/i.test(html);

    // Fallback: If publisher blocked lightweight HTTP fetch, attempt headless stealth browser
    if (htmlOverride === undefined && isAccessBlocked) {
      const browserTry = await verifyViaBrowser({
        publishedUrl,
        targetUrl,
        expectedAnchorText,
        expectedTitle,
        timeoutMs: 30_000,
      }).catch(() => null);

      if (browserTry) return browserTry;
    }

    return {
      status: isAccessBlocked ? "blocked" : "failed",
      publishedUrl,
      finalUrl,
      targetUrl,
      anchorText: "",
      httpStatus,
      relAttributes: [],
      isNofollow: false,
      isSponsored: false,
      isUgc: false,
      isDofollow: false,
      linkFound: false,
      articleContentFound: false,
      verifiedAt,
      reason: isAccessBlocked
        ? `Access restricted: Publisher returned HTTP ${httpStatus} (Cloudflare or bot protection active)`
        : `Page inaccessible: Publisher returned HTTP ${httpStatus}`,
    };
  }

  // 5. Article content check
  const plainText = html
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const titleMatch = expectedTitle ? plainText.toLowerCase().includes(expectedTitle.toLowerCase().slice(0, 30)) : null;
  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const hasArticleContent = wordCount >= 60 || titleMatch === true;

  // 6. Anchor extraction & target link verification
  const anchors = extractAnchors(html, finalUrl);
  const normTarget = normalizeDestinationUrl(targetUrl);

  const matchedAnchors = anchors.filter((a) => {
    const normLink = normalizeDestinationUrl(a.resolvedHref);
    return normLink === normTarget || normLink.startsWith(normTarget + "/") || normLink.startsWith(normTarget + "?");
  });

  if (!matchedAnchors.length) {
    // Fallback: Check if target page is a client-rendered SPA (Single Page App)
    if (htmlOverride === undefined) {
      const browserTry = await verifyViaBrowser({
        publishedUrl,
        targetUrl,
        expectedAnchorText,
        expectedTitle,
        timeoutMs: 30_000,
      }).catch(() => null);

      if (browserTry) return browserTry;
    }

    const otherOutbound = anchors.filter(
      (a) => !normalizeDestinationUrl(a.resolvedHref).includes(new URL(finalUrl).hostname.replace(/^www\./, "")),
    );

    return {
      status: "failed",
      publishedUrl,
      finalUrl,
      targetUrl,
      anchorText: "",
      httpStatus,
      relAttributes: [],
      isNofollow: false,
      isSponsored: false,
      isUgc: false,
      isDofollow: false,
      linkFound: false,
      articleContentFound: hasArticleContent,
      verifiedAt,
      reason: otherOutbound.length
        ? `Target link missing: Article links to other external destinations (${otherOutbound[0]?.resolvedHref}) but not to ${targetUrl}`
        : `Target link missing: No clickable link pointing to ${targetUrl} found on page`,
    };
  }

  // Match found! Inspect the first primary matching link
  const primary = matchedAnchors[0]!;
  const relAttrs = primary.rel;
  const isNofollow = relAttrs.includes("nofollow");
  const isSponsored = relAttrs.includes("sponsored");
  const isUgc = relAttrs.includes("ugc");
  const isDofollow = !isNofollow && !isSponsored && !isUgc;

  let reason = `Verified: Clickable hyperlink to ${targetUrl} confirmed (Anchor: "${primary.anchorText || 'No anchor text'}")`;
  if (isNofollow) {
    reason += " [Rel: nofollow]";
  } else if (isSponsored) {
    reason += " [Rel: sponsored]";
  } else if (isUgc) {
    reason += " [Rel: ugc]";
  } else {
    reason += " [Rel: dofollow]";
  }

  if (expectedAnchorText && primary.anchorText) {
    if (!primary.anchorText.toLowerCase().includes(expectedAnchorText.toLowerCase())) {
      reason += ` (Note: anchor text "${primary.anchorText}" differs from expected "${expectedAnchorText}")`;
    }
  }

  return {
    status: "verified",
    publishedUrl,
    finalUrl,
    targetUrl,
    anchorText: primary.anchorText,
    httpStatus,
    relAttributes: relAttrs,
    isNofollow,
    isSponsored,
    isUgc,
    isDofollow,
    linkFound: true,
    articleContentFound: hasArticleContent,
    verifiedAt,
    reason,
  };
}
