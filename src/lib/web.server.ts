import { isPrivateHost } from "./guestpilot";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ---------------------------------------------------------------------------
// findPublishedPost — searches a site for a recently published post matching
// the given article title and returns the URL if found.
// ---------------------------------------------------------------------------

export async function findPublishedPost(
  origin: string,
  title: string,
  sourceUrl?: string | null,
): Promise<string | null> {
  if (!title || !origin) return null;

  // Normalize title to a slug pattern for href matching
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const titleWords = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const minWordMatch = Math.min(2, titleWords.length);

  // 1. Search endpoints (WordPress, Discourse, XenForo, standard CMS)
  const searchUrls = [
    `${origin}/?s=${encodeURIComponent(title)}`,
    `${origin}/search?q=${encodeURIComponent(title)}`,
    `${origin}/search?query=${encodeURIComponent(title)}`,
  ];

  for (const sUrl of searchUrls) {
    try {
      const page = await safeGet(sUrl, 400_000);
      if (page.status >= 400) continue;
      const linkRe = /<a\b[^>]*href\s*=\s*["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(page.html))) {
        const href = m[1]?.trim() ?? "";
        const text = (m[2] ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase();
        if (!href) continue;
        let absHref: string;
        try { absHref = new URL(href, origin).toString(); } catch { continue; }
        if (!absHref.startsWith(origin)) continue;
        if (absHref.includes("search") || absHref.includes("?s=")) continue;

        const matchesSlug = href.toLowerCase().includes(slug) && slug.length > 5;
        const matchedWords = titleWords.filter((w) => text.includes(w) || href.toLowerCase().includes(w)).length;
        if (matchesSlug || matchedWords >= minWordMatch) {
          return absHref;
        }
      }
    } catch {
      /* continue */
    }
  }

  // 2. Direct paths to check (including specific source URL if given)
  const pathsToCheck: string[] = [];
  if (sourceUrl && sourceUrl.startsWith(origin)) {
    pathsToCheck.push(sourceUrl);
  }

  const commonPaths = [
    "/blog",
    "/posts",
    "/news",
    "/articles",
    "/",
    "/forums",
    "/forum",
    "/community",
    "/discuss",
    "/topics",
    "/discussions",
    "/latest",
    "/blog/recent",
  ];

  for (const p of commonPaths) {
    pathsToCheck.push(origin + p);
  }

  for (const targetUrl of pathsToCheck) {
    try {
      const page = await safeGet(targetUrl, 500_000);
      if (page.status >= 400) continue;
      // Find anchor tags
      const linkRe = /<a\b[^>]*href\s*=\s*["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(page.html))) {
        const href = m[1]?.trim() ?? "";
        const text = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
        if (!href) continue;

        // Resolve relative URLs
        let absHref: string;
        try {
          absHref = new URL(href, origin).toString();
        } catch {
          continue;
        }

        // Must be on the same origin
        if (!absHref.startsWith(origin)) continue;

        const matchesSlug = href.toLowerCase().includes(slug) && slug.length > 5;
        const matchedWords = titleWords.filter((w) =>
          text.toLowerCase().includes(w) || href.toLowerCase().includes(w),
        ).length;
        const matchesTitle = matchedWords >= minWordMatch;

        if (matchesSlug || matchesTitle) {
          return absHref;
        }
      }
    } catch {
      /* try next path */
    }
  }

  // 3. Try sitemaps
  for (const sm of ["/sitemap.xml", "/sitemap_index.xml", "/post-sitemap.xml"]) {
    try {
      const sitemap = await safeGet(origin + sm, 500_000);
      if (sitemap.status < 400) {
        const urls = [...sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
          (m) => m[1]?.trim() ?? "",
        );
        const match = urls.find((u) => u.toLowerCase().includes(slug) && slug.length > 5);
        if (match) return match;
      }
    } catch {
      /* skip */
    }
  }

  return null;
}

/** SSRF-safe GET: http(s) only, public hosts only, manual redirects re-checked, size + time capped. */
export async function safeGet(
  url: string,
  maxBytes = 1_500_000,
): Promise<{ url: string; status: number; html: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (!["http:", "https:"].includes(u.protocol) || isPrivateHost(u.hostname))
      throw new Error("Blocked URL: " + current);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: BROWSER_HEADERS,
      });
    } finally {
      clearTimeout(t);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const html = new TextDecoder().decode(concat(chunks));
    return { url: current, status: res.status, html };
  }
  throw new Error("Too many redirects");
}

function concat(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function robotsAllows(origin: string): Promise<boolean> {
  try {
    const { status, html } = await safeGet(origin + "/robots.txt", 200_000);
    if (status >= 400) return true;
    let applies = false;
    for (const line of html.split(/\r?\n/)) {
      const [k = "", ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k.trim())) applies = v === "*" || /guestpilot/i.test(v);
      else if (applies && /^disallow$/i.test(k.trim()) && v === "/") return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPlatformType(domain: string): { name: string; purpose: string } | null {
  const d = domain.toLowerCase();
  if (/thingiverse\.com|cults3d\.com|printables\.com|myminifactory\.com|grabcad\.com|sketchfab\.com|skfb\.ly/.test(d)) {
    return { name: "3D Model Repository", purpose: "sharing 3D printer files (.STL), not text blog articles" };
  }
  if (/github\.com|gitlab\.com|bitbucket\.org|sourceforge\.net/.test(d)) {
    return { name: "Code Repository", purpose: "software source code, not guest post articles" };
  }
  if (/audiomack\.com|soundcloud\.com|mixcloud\.com|spotify\.com/.test(d)) {
    return { name: "Audio/Music Platform", purpose: "streaming audio tracks, not guest post articles" };
  }
  if (/tripadvisor\.com|yelp\.com/.test(d)) {
    return { name: "Travel Review Platform", purpose: "hotel and restaurant reviews, not guest blog articles" };
  }
  if (/behance\.net|dribbble\.com|visual\.ly/.test(d)) {
    return { name: "Design Portfolio Platform", purpose: "design and visual portfolios, not standard blog articles" };
  }
  if (/stackoverflow\.com|stackexchange\.com/.test(d)) {
    return { name: "Technical Q&A Platform", purpose: "asking and answering programming questions, not guest posts" };
  }
  return null;
}

const GUEST_RE =
  /write[- ]for[- ]us|guest[- ]?post|contribut|submit|submission|guidelines|become[- ]an?[- ]author|pitch|write[- ]with[- ]us|submit[- ]article|submit[- ]post|become[- ]a[- ]contributor|content[- ]submission|forum|discuss|community|new[- ]topic|new[- ]post|new[- ]thread|topic|thread/i;
type SubmissionFeeSignal = "explicitly_free" | "fee_mentioned" | "unclear";

export function getSubmissionFeeSignal(text: string): SubmissionFeeSignal {
  const normalized = text.toLowerCase();
  if (
    /(?:free|no[- ]charge|without (?:any )?charge|at no cost)[\s\S]{0,50}(?:guest[- ]?post|submission|publishing|publication|contribut)|(?:guest[- ]?post|submission|publishing|publication|contribut)[\s\S]{0,50}(?:free|no[- ]charge|without (?:any )?charge|at no cost)/i.test(
      normalized,
    )
  ) {
    return "explicitly_free";
  }
  if (
    /(?:guest[- ]?post|submission|publishing|publication|contribut)[\s\S]{0,60}(?:fee|price|pricing|payment|paid|sponsor)|(?:fee|price|pricing|payment|paid|sponsor)[\s\S]{0,60}(?:guest[- ]?post|submission|publishing|publication|contribut)/i.test(
      normalized,
    )
  ) {
    return "fee_mentioned";
  }
  return "unclear";
}

export async function discover(siteUrl: string) {
  const origin = new URL(siteUrl).origin;
  if (!(await robotsAllows(origin))) return { blocked: true as const, origin };
  const home = await safeGet(siteUrl);
  if (home.status >= 400) {
    const isCloudflare =
      home.status === 403 ||
      /cloudflare|challenges\.cloudflare|turnstile|cf-mitigated/i.test(home.html);

    return {
      blocked: false as const,
      origin,
      title: null,
      homepageExcerpt: "",
      guidelinesUrl: null,
      guidelines: "",
      submissionFeeSignal: "unclear" as const,
      hasSubmissionForm: false,
      captchaDetected: isCloudflare,
      cloudflareProtected: isCloudflare,
      httpStatus: home.status,
      loginUrls: [`${origin}/login`, `${origin}/signin`, `${origin}/account`],
      contactUrls: [],
      emails: [] as string[],
      checkedAt: new Date().toISOString(),
    };
  }
  const links: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(home.html))) {
    try {
      links.push({
        href: new URL(m[1] ?? "", home.url).toString(),
        text: (m[2] ?? "").replace(/<[^>]+>/g, "").trim(),
      });
    } catch {
      /* ignore */
    }
  }
  const sameSite = links.filter(
    (l) => l.href.startsWith(origin) || l.href.startsWith(origin.replace("://", "://www.")),
  );
  const candidates = [
    siteUrl,
    ...new Set(
      sameSite.filter((l) => GUEST_RE.test(l.href) || GUEST_RE.test(l.text)).map((l) => l.href),
    ),
  ].slice(0, 10);
  for (const p of [
    "/write-for-us",
    "/guest-post-guidelines",
    "/contribute",
    "/submit",
    "/submit-article",
    "/submit-post",
    "/submit-a-post",
    "/submit-content",
    "/write",
    "/write-with-us",
    "/become-a-contributor",
    "/become-an-author",
    "/guest-author",
    "/guest-authors",
    "/authors",
    "/content-guidelines",
    "/editorial-guidelines",
    "/blog/write-for-us",
    "/blog/guest-post",
    "/write-for-us/",
    "/guest-post/",
  ]) {
    if (candidates.length >= 6) break;
    candidates.push(origin + p);
  }
  const loginUrls = [
    ...new Set(
      sameSite
        .filter((l) => /log-?in|sign-?in|wp-admin|account/i.test(l.href + l.text))
        .map((l) => l.href),
    ),
  ].slice(0, 3);
  const contactUrls = [
    ...new Set(sameSite.filter((l) => /contact/i.test(l.href + l.text)).map((l) => l.href)),
  ].slice(0, 2);
  const emails = new Set<string>(
    (home.html.match(/mailto:([^"'?\s>]+)/gi) ?? []).map((e) => e.slice(7).toLowerCase()),
  );

  let guidelinesUrl: string | null = null;
  let guidelines = "";
  let hasForm = false;
  let captcha = false;
  for (const c of candidates) {
    try {
      const page = await safeGet(c);
      if (page.status >= 400) continue;
      const text = htmlToText(page.html);
      if (!GUEST_RE.test(text)) continue;
      guidelinesUrl = page.url;
      guidelines = text.slice(0, 6000);
      hasForm =
        /(<form[\s\S]*?<textarea)/i.test(page.html) ||
        // WordPress / Gutenberg / rich-text editors
        /wp-editor|tinymce|quill|froala|ckeditor|mce-content-body|gutenberg|rich-text/i.test(page.html) ||
        // Contact/submission forms that mention guest post in page text
        (/<form[\s\S]*?<\/form>/i.test(page.html) && /guest[- ]?post|submit|contribut/i.test(text.slice(0, 2000)));
      captcha = /g-recaptcha|hcaptcha|cf-turnstile|data-sitekey/i.test(page.html);
      (page.html.match(/mailto:([^"'?\s>]+)/gi) ?? []).forEach((e) =>
        emails.add(e.slice(7).toLowerCase()),
      );
      (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
        .slice(0, 5)
        .forEach((e) => emails.add(e.toLowerCase()));
      break;
    } catch {
      /* try next */
    }
  }
  return {
    blocked: false as const,
    origin,
    title:
      home.html
        .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.trim()
        .slice(0, 200) ?? null,
    homepageExcerpt: htmlToText(home.html).slice(0, 1500),
    guidelinesUrl,
    guidelines,
    submissionFeeSignal: getSubmissionFeeSignal(guidelines),
    hasSubmissionForm: hasForm,
    captchaDetected: captcha,
    loginUrls,
    contactUrls,
    emails: [...emails].slice(0, 5),
    checkedAt: new Date().toISOString(),
  };
}
