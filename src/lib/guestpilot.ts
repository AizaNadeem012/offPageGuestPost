// Pure, browser-and-server-safe helpers (tested in src/test/guestpilot.test.ts)

export type WebsiteStatus =
  | "queued"
  | "discovering"
  | "writing"
  | "ready_for_review"
  | "approved"
  | "submitted"
  | "awaiting_approval"
  | "published"
  | "action_required"
  | "failed"
  | "skipped"
  | "discovered"
  | "qualified"
  | "ready_to_submit"
  | "submission_attempted"
  | "submission_confirmed"
  | "awaiting_review"
  | "published_unverified"
  | "verified"
  | "rejected"
  | "verification_failed"
  | "blocked";

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  discovering: "Discovering",
  writing: "Writing",
  ready_for_review: "Ready for review",
  approved: "Approved",
  submitted: "Submitted",
  awaiting_approval: "Awaiting approval",
  published: "Verified Backlink",
  verified: "Verified Backlink",
  VERIFIED: "Verified Backlink",
  published_unverified: "Published (Unverified)",
  PUBLISHED_UNVERIFIED: "Published (Unverified)",
  submission_attempted: "Submission Attempted",
  SUBMISSION_ATTEMPTED: "Submission Attempted",
  submission_confirmed: "Submission Confirmed",
  SUBMISSION_CONFIRMED: "Submission Confirmed",
  awaiting_review: "Awaiting Review",
  AWAITING_REVIEW: "Awaiting Review",
  verification_failed: "Verification Failed",
  VERIFICATION_FAILED: "Verification Failed",
  blocked: "Blocked",
  BLOCKED: "Blocked",
  rejected: "Rejected",
  REJECTED: "Rejected",
  discovered: "Discovered",
  DISCOVERED: "Discovered",
  qualified: "Qualified",
  QUALIFIED: "Qualified",
  ready_to_submit: "Ready to Submit",
  READY_TO_SUBMIT: "Ready to Submit",
  action_required: "Action required",
  failed: "Failed",
  skipped: "Skipped",
};

export type ImportRow = {
  url: string;
  domain: string;
  category?: string | undefined;
  login_url?: string | undefined;
  preferred_anchor?: string | undefined;
  target_url?: string | undefined;
  priority: number;
  notes?: string | undefined;
};

export type ImportIssue = { row: number; value: string; reason: string };

const FIELD_ALIASES: Record<keyof Omit<ImportRow, "domain">, string[]> = {
  url: ["url", "website", "site", "domain", "website url", "site url", "link"],
  category: ["category", "niche", "topic"],
  login_url: ["login", "login url", "login page", "portal"],
  preferred_anchor: ["anchor", "anchor text", "preferred anchor"],
  target_url: ["target", "target url", "money page", "landing page"],
  priority: ["priority", "rank"],
  notes: ["notes", "note", "comments"],
};
const SECRET_COLUMNS = /pass(word)?|pwd|secret|token|otp|api.?key/i;

export function detectColumns(headers: string[]) {
  const map: Partial<Record<keyof typeof FIELD_ALIASES, string>> = {};
  const ignoredSecrets: string[] = [];
  for (const h of headers) {
    const n = h.trim().toLowerCase().replace(/[_-]+/g, " ");
    if (SECRET_COLUMNS.test(n)) {
      ignoredSecrets.push(h);
      continue;
    }
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (!map[field as keyof typeof FIELD_ALIASES] && aliases.includes(n)) {
        map[field as keyof typeof FIELD_ALIASES] = h;
      }
    }
  }
  return { map, ignoredSecrets };
}

export function normalizeUrl(raw: string): { url: string; domain: string } | null {
  let v = (raw ?? "").toString().trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
    if (isPrivateHost(host)) return null;
    const domain = host.replace(/^www\./, "");
    return { url: `${u.protocol}//${host}${u.pathname === "/" ? "" : u.pathname}`, domain };
  } catch {
    return null;
  }
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  )
    return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return h.includes(":"); // raw IPv6 not allowed
}

export function parseRows(rawRecords: Record<string, unknown>[]) {
  let records = rawRecords; // mutable local copy for header-less fallback
  const headers = Object.keys(records[0] ?? {});
  let { map, ignoredSecrets } = detectColumns(headers);
  const rows: ImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();

  // ── Header-less / title-row fallback ─────────────────────────────────────
  // If no url column was found, check if:
  // (a) The first "header" cell itself looks like a URL → truly header-less file
  //     (xlsx.sheet_to_json uses first row as keys, so headers[0] IS the URL)
  // (b) The header is a title string (like "NANDLA LINKS SITES") and actual
  //     URLs are in the record values of column A (first key).
  if (!map.url) {
    const firstKey = headers[0] ?? "";
    // Case (a): header itself is a URL (header-less CSV/XLSX)
    if (/^https?:\/\//i.test(firstKey) || /^www\./i.test(firstKey)) {
      // Treat headers row as first data row — reconstruct records
      const syntheticFirst: Record<string, unknown> = { __url: firstKey };
      const remapped = records.map((r) => {
        const vals = Object.values(r);
        return { __url: vals[0] ?? "" } as Record<string, unknown>;
      });
      records = [syntheticFirst, ...remapped];
      map = { ...map, url: "__url" };
    }
    // Case (b): title row — check if column A values look like URLs
    else if (records.length > 0) {
      const firstVal = String(Object.values(records[0])[0] ?? "").trim();
      if (/^https?:\/\//i.test(firstVal) || /^www\./i.test(firstVal)) {
        // Column A values are URLs; map the first column key as url
        map = { ...map, url: firstKey };
      }
      // Case (c): title row like "NANDLA LINKS SITES" then URLs start row 2
      // skip row 0 (title) and treat remaining rows' first column as URLs
      else if (records.length > 1) {
        const secondVal = String(Object.values(records[1])[0] ?? "").trim();
        if (/^https?:\/\//i.test(secondVal) || /^www\./i.test(secondVal)) {
          records = records.slice(1); // skip the title row
          map = { ...map, url: firstKey };
        }
      }
    }
  }

  if (!map.url)
    return {
      rows,
      issues: [{ row: 0, value: "", reason: "No website/URL column found. Add a header row with a column named 'URL' or 'Website', or make sure URLs start from row 1." }],
      ignoredSecrets,
      map,
    };
  records.forEach((r, i) => {
    const raw = String(r[map.url!] ?? "");
    const n = normalizeUrl(raw);
    if (!n) {
      if (raw.trim()) issues.push({ row: i + 2, value: raw, reason: "Invalid or disallowed URL" });
      return;
    }
    if (seen.has(n.domain)) {
      issues.push({ row: i + 2, value: raw, reason: "Duplicate domain" });
      return;
    }
    seen.add(n.domain);
    const get = (k: keyof typeof map) =>
      map[k] ? String(r[map[k]!] ?? "").trim() || undefined : undefined;
    const target = get("target_url");
    rows.push({
      ...n,
      category: get("category"),
      login_url: get("login_url"),
      preferred_anchor: get("preferred_anchor"),
      target_url: target && normalizeUrl(target) ? target : undefined,
      priority: Number(get("priority")) || 0,
      notes: get("notes"),
    });
  });
  return { rows, issues, ignoredSecrets, map };
}

export function parseCampaignBrief(prompt: string) {
  const fields: Record<string, string> = {};
  for (const line of prompt.split(/\r?\n/)) {
    if (/^\s*Article\s+(Title|Content)\s*:/i.test(line)) break;
    const match = line.match(/^\s*([^:]{2,40})\s*:\s*(.*?)\s*$/);
    if (match?.[1] && match[2]) fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  const get = (...labels: string[]) =>
    labels.map((label) => fields[label]).find((value) => value !== undefined) ?? "";
  const list = (...labels: string[]) =>
    get(...labels)
      .split(/[,;\n]/)
      .map((value) => value.trim())
      .filter(Boolean);

  return {
    campaignName: get("campaign name", "campaign") || "Guest post campaign",
    businessName: get("business name", "business", "brand") || "",
    website: get("website", "business website", "site") || "",
    services: list("services", "products"),
    targetAudience: get("target audience", "audience") || "",
    keywords: list("keywords", "target keywords"),
    targetUrls: list("target urls", "target url", "landing pages"),
    anchorTexts: list("anchor texts", "anchor text", "anchors"),
    tone: get("tone", "brand tone") || "",
    requirements: list("requirements", "guest post requirements"),
    missingInfo: [],
  };
}

export function parseManualArticle(prompt: string) {
  const lines = prompt.split(/\r?\n/);
  const titleLineIndex = lines.findIndex((line) => /^\s*Article\s+Title\s*:/i.test(line));
  const contentLineIndex = lines.findIndex((line) => /^\s*Article\s+Content\s*:/i.test(line));
  const rawTitle =
    titleLineIndex === -1
      ? ""
      : lines[titleLineIndex]!.replace(/^\s*Article\s+Title\s*:\s*/i, "").trim();
  const title = (rawTitle || "Guest post draft").slice(0, 300);
  const contentStartIndex =
    contentLineIndex !== -1 ? contentLineIndex : titleLineIndex !== -1 ? titleLineIndex + 1 : -1;
  const contentLines =
    contentStartIndex === -1
      ? lines
      : [
          ...(contentLineIndex !== -1
            ? [lines[contentLineIndex]!.replace(/^\s*Article\s+Content\s*:\s*/i, "")]
            : []),
          ...lines.slice(contentStartIndex + (contentLineIndex !== -1 ? 1 : 0)),
        ];
  const endMarkerIndex = contentLines.findIndex((line) => /^\s*End Article\s*$/i.test(line));
  const extractedContent = (
    endMarkerIndex === -1 ? contentLines : contentLines.slice(0, endMarkerIndex)
  )
    .join("\n")
    .trim();
  return { title, content: extractedContent || prompt.trim() };
}

export function getManualArticleError(article: { title: string; content: string }) {
  if (!article.content) return "Prompt mein apna business ya article ka kuch text likhein.";
  if (article.content.length > 60000)
    return "Prompt/article 60,000 characters se chhota hona chahiye.";
  return null;
}

/** Finds links in HTML pointing at targetUrl. Returns anchor text + rel. */
export function findBacklinks(html: string, targetUrl: string) {
  const norm = (u: string) =>
    u
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "");
  const target = norm(targetUrl);
  const out: { href: string; anchor: string; rel: string }[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    if (
      norm(href) === target ||
      norm(href).startsWith(target + "?") ||
      norm(href).startsWith(target + "#")
    ) {
      out.push({
        href,
        anchor: (m[2] ?? "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
        rel: attrs.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1] ?? "dofollow",
      });
    }
  }
  return out;
}

export function computeStats(websites: { status: string }[], articleCount: number) {
  const norm = (s: string) => (s ?? "").toLowerCase();
  const c = (statuses: string[]) => {
    const set = new Set(statuses.map((x) => x.toLowerCase()));
    return websites.filter((w) => set.has(norm(w.status))).length;
  };
  return {
    total: websites.length,
    processed: websites.length - c(["queued", "discovering", "writing", "discovered"]),
    articles: articleCount,
    submissions: c(["submitted", "submission_attempted", "submission_confirmed", "awaiting_approval", "awaiting_review", "published", "verified"]),
    verified: c(["published", "verified"]),
    pending: c([
      "ready_for_review",
      "approved",
      "submitted",
      "submission_attempted",
      "submission_confirmed",
      "awaiting_approval",
      "awaiting_review",
      "ready_to_submit",
      "published_unverified",
    ]),
    failures: c(["failed", "action_required", "verification_failed", "blocked", "rejected"]),
    actionRequired: c(["action_required", "verification_failed", "blocked"]),
    published: c(["published", "verified"]),
    queued: c(["queued", "discovering", "writing", "discovered"]),
    failed: c(["failed", "action_required", "verification_failed", "blocked", "rejected"]),
  };
}

export function redact(text: string): string {
  return text
    .replace(/(password|pwd|token|secret|otp|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\b(sk|lovc|sb_secret)_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b\d{6}\b(?=.*\b(code|otp)\b)/gi, "[redacted]");
}

export function wordCount(s: string) {
  return s
    .replace(/[#*_>`[\]()-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
