import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  computeStats,
  findBacklinks,
  parseCampaignBrief,
  parseManualArticle,
  getManualArticleError,
  redact,
  wordCount,
  type ImportRow,
} from "./guestpilot";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function log(
  campaign_id: string | null,
  message: string,
  level = "info",
  website_id: string | null = null,
) {
  const s = await db();
  await s
    .from("activity_logs")
    .insert({ campaign_id, website_id, level, message: redact(message).slice(0, 1000) });
}

async function getSettings() {
  const s = await db();
  const { data } = await s.from("settings").select("data").eq("id", 1).single();
  return (data?.data ?? {}) as {
    requestDelayMs: number;
    maxAttempts: number;
    requireApproval: boolean;
    minWords: number;
    maxWords: number;
  };
}

const ConfigSchema = z.object({
  campaignName: z.string(),
  businessName: z.string(),
  website: z.string(),
  services: z.array(z.string()),
  targetAudience: z.string(),
  keywords: z.array(z.string()),
  targetUrls: z.array(z.string()),
  anchorTexts: z.array(z.string()),
  tone: z.string(),
  requirements: z.array(z.string()),
  missingInfo: z.array(z.string()),
});
export type CampaignConfig = z.infer<typeof ConfigSchema>;

export const parseCampaignPrompt = createServerFn({ method: "POST" })
  .validator((d: { prompt: string }) => z.object({ prompt: z.string().max(60000) }).parse(d))
  .handler(async ({ data }) => {
    const article = parseManualArticle(data.prompt);
    const articleError = getManualArticleError(article);
    if (articleError) throw new Error(articleError);
    return {
      config: ConfigSchema.parse(parseCampaignBrief(data.prompt)),
      articleTitle: article.title,
      articleContent: article.content,
    };
  });

const RowSchema = z.object({
  url: z.string().url(),
  domain: z.string(),
  category: z.string().optional(),
  login_url: z.string().optional(),
  preferred_anchor: z.string().optional(),
  target_url: z.string().optional(),
  priority: z.number(),
  notes: z.string().optional(),
});

export const createCampaign = createServerFn({ method: "POST" })
  .validator(
    (d: {
      prompt: string;
      config: CampaignConfig;
      articleTitle: string;
      articleContent: string;
      rows: ImportRow[];
      filename: string;
    }) =>
      z
        .object({
          prompt: z.string().max(60000),
          config: ConfigSchema,
          articleTitle: z.string().max(300),
          articleContent: z.string().max(60000),
          rows: z.array(RowSchema).min(1).max(2000),
          filename: z.string().max(200),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    const { data: c, error } = await s
      .from("campaigns")
      .insert({
        name: data.config.campaignName || data.filename,
        prompt: data.prompt,
        config: data.config,
        missing_info: data.config.missingInfo,
        source_filename: data.filename,
        status: "running",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const { error: e2 } = await s.from("websites").insert(
      data.rows.map((r) => ({
        url: r.url,
        domain: r.domain,
        priority: r.priority,
        category: r.category ?? null,
        login_url: r.login_url ?? null,
        preferred_anchor: r.preferred_anchor ?? null,
        target_url: r.target_url ?? null,
        article_title: data.articleTitle,
        article_content: data.articleContent,
        notes: r.notes ?? null,
        campaign_id: c.id,
      })),
    );
    if (e2) throw new Error(e2.message);
    await log(c.id, `Campaign started with ${data.rows.length} websites from ${data.filename}`);
    return { id: c.id };
  });

export const listCampaigns = createServerFn({ method: "GET" }).handler(async () => {
  const s = await db();
  const { data } = await s
    .from("campaigns")
    .select("id,name,status,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
});

export const getCampaign = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    // recover jobs abandoned mid-step (tab closed / worker crash)
    await s
      .from("websites")
      .update({ status: "queued", locked_at: null })
      .eq("campaign_id", data.id)
      .in("status", ["discovering", "writing"])
      .lt("locked_at", new Date(Date.now() - 5 * 60_000).toISOString());
    const [{ data: campaign }, { data: websites }, { count }, { data: logs }] = await Promise.all([
      s.from("campaigns").select("*").eq("id", data.id).single(),
      s
        .from("websites")
        .select("*")
        .eq("campaign_id", data.id)
        .order("priority", { ascending: false })
        .order("created_at"),
      s.from("articles").select("id", { count: "exact", head: true }).eq("campaign_id", data.id),
      s
        .from("activity_logs")
        .select("*")
        .eq("campaign_id", data.id)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    if (!campaign) throw new Error("Campaign not found");
    const { data: articles } = await s
      .from("articles")
      .select("id,website_id,title,status,word_count")
      .eq("campaign_id", data.id);
    return {
      campaign,
      websites: websites ?? [],
      articles: articles ?? [],
      logs: logs ?? [],
      stats: computeStats(websites ?? [], count ?? 0),
    };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .validator((d: { id: string; status: "running" | "paused" | "cancelled" }) =>
    z
      .object({ id: z.string().uuid(), status: z.enum(["running", "paused", "cancelled"]) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    await s
      .from("campaigns")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (data.status === "cancelled")
      await s
        .from("websites")
        .update({ status: "skipped" })
        .eq("campaign_id", data.id)
        .eq("status", "queued");
    await log(data.id, `Campaign ${data.status}`);
    return { ok: true };
  });

/** Processes exactly one queued website. Called repeatedly by the dashboard runner. */
export const processNext = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    const settings = await getSettings();
    const { data: campaign } = await s.from("campaigns").select("*").eq("id", data.id).single();
    if (!campaign || campaign.status !== "running") return { state: "idle" as const };
    const { data: next } = await s
      .from("websites")
      .select("*")
      .eq("campaign_id", data.id)
      .eq("status", "queued")
      .order("priority", { ascending: false })
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!next) {
      // Double-check: are there any still in-flight websites? (discovering/writing/locked)
      const { count: inFlight } = await s
        .from("websites")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", data.id)
        .in("status", ["discovering", "writing"]);
      if ((inFlight ?? 0) > 0) return { state: "busy" as const };

      await s.from("campaigns").update({ status: "completed" }).eq("id", data.id);
      await log(data.id, "All websites processed — campaign completed");
      const { count: totalCount } = await s
        .from("websites")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", data.id);
      const total = totalCount ?? 0;
      return { state: "done" as const, total, processed: total, remaining: 0 };
    }
    // atomic claim: only one runner can move it out of "queued"
    const { data: claimed } = await s
      .from("websites")
      .update({
        status: "discovering",
        locked_at: new Date().toISOString(),
        attempts: next.attempts + 1,
      })
      .eq("id", next.id)
      .eq("status", "queued")
      .select()
      .maybeSingle();
    if (!claimed) return { state: "busy" as const };
    const w = claimed;
    const cfg = campaign.config as CampaignConfig;
    try {
      // ── Article fallback: if spreadsheet has no article, generate a template ──
      let articleTitle = w.article_title?.trim();
      let articleContent = w.article_content?.trim();

      if (!articleTitle || !articleContent) {
        // Build a template article from campaign config
        const biz = cfg.businessName || "our company";
        const site = cfg.website || "";
        const kw = cfg.keywords.slice(0, 3).join(", ") || "web development services";
        const audience = cfg.targetAudience || "businesses";
        const services = cfg.services.slice(0, 3).join(", ") || "web development";

        articleTitle = articleTitle || `How ${biz} Helps ${audience} with ${cfg.keywords[0] || kw}`;
        if (!articleContent) {
          articleContent = `## Introduction

In today's digital-first world, having a strong online presence is essential for ${audience}. ${biz} specializes in ${services}, helping businesses grow and succeed online.

## Why ${kw.split(",")[0]?.trim() || "Web Development"} Matters

A professional website is more than just an online brochure — it's your most powerful marketing tool. When done right, it drives traffic, generates leads, and converts visitors into customers.

For ${audience}, investing in quality ${services} means:

- **Credibility**: A professional website builds trust with your target audience
- **Visibility**: Search-engine-optimized websites attract organic traffic
- **Conversion**: Well-designed user experiences turn visitors into clients
- **Scalability**: Modern web applications grow with your business

## What ${biz} Offers

At ${biz}, we provide end-to-end ${services} solutions tailored to your specific needs:

1. **Custom Design**: Every website we build is unique and aligned with your brand
2. **Responsive Development**: Sites that look great on all devices
3. **Performance Optimization**: Fast-loading pages that rank well in search engines
4. **Ongoing Support**: We're here after launch to help you succeed

## Getting Started

Whether you're launching a new business or redesigning an existing website, ${biz} is ready to help. Our team of experienced developers and designers will work closely with you to understand your goals and deliver results that exceed expectations.

${site ? `Learn more about our services at ${site}.` : "Contact us today to discuss your project."}

## Conclusion

Investing in quality ${kw.split(",")[0]?.trim() || "web development"} is one of the best decisions you can make for your business. With the right partner, you can build a powerful online presence that drives real results.

*${biz} is a professional web development agency helping ${audience} build better websites and digital experiences.*`;
        }
      }
      const { discover } = await import("./web.server");
      await log(data.id, `Inspecting ${w.domain}`, "info", w.id);
      const d = await discover(w.url);
      if (d.blocked) {
        await s
          .from("websites")
          .update({ status: "skipped", discovery: d, last_error: "robots.txt disallows crawling" })
          .eq("id", w.id);
        await log(data.id, `${w.domain}: skipped — robots.txt disallows crawling`, "warn", w.id);
        return { state: "processed" as const };
      }
      await s.from("websites").update({ discovery: d, status: "writing" }).eq("id", w.id);
      await log(
        data.id,
        `${w.domain}: ${d.guidelinesUrl ? "found guidelines at " + d.guidelinesUrl : "no guest post page found"}${d.emails.length ? ", contact " + d.emails[0] : ""}`,
        "info",
        w.id,
      );

      const article = {
        title: articleTitle,
        content: articleContent,
        anchor: w.preferred_anchor || cfg.anchorTexts[0] || null,
        target: w.target_url || cfg.targetUrls[0] || cfg.website || null,
      };
      const { data: a } = await s
        .from("articles")
        .insert({
          website_id: w.id,
          campaign_id: data.id,
          title: article.title,
          content: article.content,
          anchor_text: article.anchor,
          target_url: article.target,
          word_count: wordCount(article.content),
          status: settings.requireApproval ? "ready_for_review" : "approved",
        })
        .select()
        .single();
      if (a)
        await s.from("article_revisions").insert({
          article_id: a.id,
          version: 1,
          title: a.title,
          content: a.content,
          note: "Initial draft",
        });

      // ── Automated form submission ────────────────────────────────────────
      // Always attempt auto-submission regardless of requireApproval setting.
      // requireApproval only controls whether humans must review the *article*,
      // not whether we attempt the actual site submission.
      let submissionNote: string | null = null;
      let autoSubmitStatus: string | null = null;

      const { submitGuestPost } = await import("./submission.server");
      const cfg2 = campaign.config as CampaignConfig;

      const isCloudflare =
        (d as { cloudflareProtected?: boolean; httpStatus?: number }).cloudflareProtected ||
        (d as { cloudflareProtected?: boolean; httpStatus?: number }).httpStatus === 403;
      const isForum = w.domain.includes("forum.") || /forum|community|discuss/i.test(w.url);

      const { getPlatformType } = await import("./web.server");
      const platformType = getPlatformType(w.domain);

      if (platformType) {
        submissionNote = `ℹ️ ${platformType.name} (${w.domain}): This platform is for ${platformType.purpose}. Recommended: Put your backlink in your Account Profile / Bio.`;
        autoSubmitStatus = "action_required";
        await log(
          data.id,
          `${w.domain}: identified as ${platformType.name} — article saved, profile backlink recommended`,
          "info",
          w.id,
        );
      } else if (isCloudflare || isForum || (d.hasSubmissionForm && d.guidelinesUrl)) {
        // Attempt automated submission via real headless browser agent (bypasses Cloudflare)
        await log(
          data.id,
          `${w.domain}: attempting automated browser submission...`,
          "info",
          w.id,
        );
        const subResult = await submitGuestPost({
          submissionUrl: d.guidelinesUrl ?? w.url,
          loginUrl: d.loginUrls[0] ?? null,
          domain: w.domain,
          article: {
            title: article.title,
            content: article.content,
            ...(cfg2.businessName ? { authorName: cfg2.businessName } : {}),
            targetUrl: article.target || undefined,
          },
        });

        switch (subResult.outcome) {
          case "submitted": {
            submissionNote = "✅ " + subResult.note;
            autoSubmitStatus = "submitted";
            // ── Auto-detect candidate publication URL ────────────────────────
            // CRITICAL RULE: Never save submission form URL or receipt URL as publication_url!
            // Only save if an actual published article link was discovered and validated.
            try {
              const { findPublishedPost } = await import("./web.server");
              const { validateCandidateUrl } = await import("./verification.server");
              const siteOrigin = new URL(w.url).origin;
              const pubUrl = await findPublishedPost(siteOrigin, article.title).catch(() => null);
              if (pubUrl) {
                const validation = validateCandidateUrl(pubUrl);
                if (validation.valid) {
                  await s.from("websites").update({
                    publication_url: pubUrl,
                    status: "published_unverified",
                  }).eq("id", w.id);
                  submissionNote += ` — 🔗 Candidate published URL auto-detected: ${pubUrl} (verification pending)`;
                }
              }
            } catch {
              /* non-fatal — candidate URL will be verified later */
            }
            await log(data.id, `${w.domain}: ${subResult.note}`, "success", w.id);
            break;
          }
          case "captcha":
            submissionNote =
              "⚠️ CAPTCHA appeared during submission — please complete manually at: " +
              (d.guidelinesUrl ?? "");
            autoSubmitStatus = "action_required";
            await log(
              data.id,
              `${w.domain}: CAPTCHA appeared during submission — manual needed`,
              "warn",
              w.id,
            );
            break;
          case "login_failed":
            submissionNote = `⚠️ Login failed: ${subResult.note}. Please submit manually.`;
            autoSubmitStatus = "action_required";
            await log(data.id, `${w.domain}: login failed — ${subResult.note}`, "warn", w.id);
            break;
          case "no_form":
            // No textarea found — fall through to email / manual
            submissionNote = subResult.note;
            autoSubmitStatus = null;
            await log(
              data.id,
              `${w.domain}: no submission textarea found — ${subResult.note}`,
              "info",
              w.id,
            );
            break;
          case "error":
            submissionNote = `⚠️ Submission error: ${subResult.note}`;
            autoSubmitStatus = "action_required";
            await log(data.id, `${w.domain}: submission error — ${subResult.note}`, "warn", w.id);
            break;
        }
      } else if (!d.hasSubmissionForm && d.emails.length) {
        // No form but email found — send outreach email automatically
        const contactEmail = d.emails[0]!;
        await log(
          data.id,
          `${w.domain}: no form found — sending outreach email to ${contactEmail}`,
          "info",
          w.id,
        );
        try {
          const { sendGuestPostOutreach } = await import("./email.server");
          const cfg3 = campaign.config as CampaignConfig;
          const emailResult = await sendGuestPostOutreach({
            to: contactEmail,
            publisherDomain: w.domain,
            article: { title: article.title, content: article.content },
            authorName: cfg3.businessName || undefined,
            targetUrl: article.target || undefined,
            anchorText: article.anchor || undefined,
          });
          submissionNote = `✅ Outreach email sent to ${contactEmail} (ID: ${emailResult.messageId})`;
          autoSubmitStatus = "submitted";
          await log(data.id, `${w.domain}: outreach email sent to ${contactEmail}`, "success", w.id);
        } catch (emailErr) {
          const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
          submissionNote = `⚠️ Could not send email to ${contactEmail}: ${msg}. Send manually.`;
          autoSubmitStatus = null;
          await log(data.id, `${w.domain}: email send failed — ${msg}`, "warn", w.id);
        }
      } else if (!d.guidelinesUrl && !d.emails.length) {
        // Nothing found — action required
        submissionNote = "⚠️ No submission form or contact email found — manual research needed.";
        autoSubmitStatus = "action_required";
        await log(data.id, `${w.domain}: no form or email found`, "warn", w.id);
      }

      const pkg = {
        method: d.emails.length ? "email" : d.hasSubmissionForm ? "form" : "manual",
        to: d.emails[0] ?? null,
        formUrl: d.hasSubmissionForm ? d.guidelinesUrl : null,
        contactUrl: d.contactUrls[0] ?? null,
        note: submissionNote,
      };

      // Final status logic:
      // - If auto-submit ran and succeeded → "submitted"
      // - If CAPTCHA or error → "action_required"
      // - If requireApproval is on → "ready_for_review" (human must review article first)
      // - Otherwise → "approved" (ready to send via email manually)
      const needsHuman = !d.emails.length && !d.hasSubmissionForm && !d.guidelinesUrl;
      const computedStatus =
        autoSubmitStatus ??
        (needsHuman
          ? "action_required"
          : settings.requireApproval
            ? "ready_for_review"
            : "approved");

      await s
        .from("websites")
        .update({
          status: computedStatus,
          submission_package: pkg,
          locked_at: null,
          last_error: null,
          ...(autoSubmitStatus === "submitted"
            ? { submitted_at: new Date().toISOString(), stage: "submitted" }
            : {}),
        })
        .eq("id", w.id);
      await log(
        data.id,
        `${w.domain}: article "${article.title}" saved (${wordCount(article.content)} words) — status: ${computedStatus}`,
        "success",
        w.id,
      );

      const [{ count: queuedCount }, { count: totalCount }, { data: updatedW }] = await Promise.all([
        s.from("websites").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).in("status", ["queued", "discovering", "writing"]),
        s.from("websites").select("id", { count: "exact", head: true }).eq("campaign_id", data.id),
        s.from("websites").select("id, domain, url, status, publication_url").eq("id", w.id).maybeSingle(),
      ]);
      const total = totalCount ?? 0;
      const remaining = queuedCount ?? 0;
      const processed = Math.min(total, Math.max(0, total - remaining));

      return {
        state: "processed" as const,
        total,
        processed,
        remaining,
        website: {
          id: w.id,
          domain: w.domain,
          url: w.url,
          status: updatedW?.status ?? computedStatus,
          publication_url: updatedW?.publication_url ?? null,
          articleTitle: article.title,
          articleId: a?.id ?? null,
          note: submissionNote,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = (e as { status?: number }).status;
      const maxAttempts = settings.maxAttempts || 2;
      const retry = w.attempts < maxAttempts && status !== 402 && status !== 403;
      await s
        .from("websites")
        .update({
          status: retry ? "queued" : "failed",
          last_error: msg.slice(0, 500),
          locked_at: null,
        })
        .eq("id", w.id);
      await log(data.id, `${w.domain}: ${msg}${retry ? " — will retry" : ""}`, "error", w.id);
      if (status === 402) {
        await s.from("campaigns").update({ status: "paused" }).eq("id", data.id);
        await log(
          data.id,
          "Campaign paused due to service quota/billing configuration issue.",
          "error",
        );
        return { state: "paused" as const, error: msg };
      }

      const [{ count: queuedCount }, { count: totalCount }] = await Promise.all([
        s.from("websites").select("id", { count: "exact", head: true }).eq("campaign_id", data.id).in("status", ["queued", "discovering", "writing"]),
        s.from("websites").select("id", { count: "exact", head: true }).eq("campaign_id", data.id),
      ]);
      const total = totalCount ?? 0;
      const remaining = queuedCount ?? 0;
      const processed = Math.min(total, Math.max(0, total - remaining));

      return {
        state: "processed" as const,
        total,
        processed,
        remaining,
        website: {
          id: w.id,
          domain: w.domain,
          url: w.url,
          status: retry ? "queued" : "failed",
          publication_url: null,
          articleTitle: "",
          articleId: null,
          note: msg,
        },
      };
    }
  });

export const retryWebsite = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    const { data: w } = await s
      .from("websites")
      .update({ status: "queued", attempts: 0, last_error: null })
      .eq("id", data.id)
      .select()
      .single();
    if (w) {
      await s
        .from("campaigns")
        .update({ status: "running" })
        .eq("id", w.campaign_id)
        .in("status", ["completed", "paused"]);
      await log(w.campaign_id, `${w.domain}: queued for retry`, "info", w.id);
    }
    return { ok: true };
  });

export const getArticle = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    const { data: article } = await s.from("articles").select("*").eq("id", data.id).single();
    if (!article) throw new Error("Article not found");
    const [{ data: website }, { data: revisions }, { data: templates }, { data: campaign }] =
      await Promise.all([
        s.from("websites").select("*").eq("id", article.website_id).single(),
        s
          .from("article_revisions")
          .select("*")
          .eq("article_id", data.id)
          .order("version", { ascending: false }),
        s.from("outreach_templates").select("*").order("created_at"),
        s.from("campaigns").select("id,name,config").eq("id", article.campaign_id).single(),
      ]);
    return { article, website, revisions: revisions ?? [], templates: templates ?? [], campaign };
  });

export const saveArticle = createServerFn({ method: "POST" })
  .validator((d: { id: string; title: string; content: string }) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(300),
        content: z.string().min(1).max(60000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    const { data: a } = await s.from("articles").select("version").eq("id", data.id).single();
    const version = (a?.version ?? 1) + 1;
    await s
      .from("articles")
      .update({
        title: data.title,
        content: data.content,
        word_count: wordCount(data.content),
        version,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    await s.from("article_revisions").insert({
      article_id: data.id,
      version,
      title: data.title,
      content: data.content,
      note: "Manual edit",
    });
    return { version };
  });

export const setArticleStatus = createServerFn({ method: "POST" })
  .validator((d: { id: string; status: "approved" | "ready_for_review" }) =>
    z.object({ id: z.string().uuid(), status: z.enum(["approved", "ready_for_review"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    const { data: a } = await s
      .from("articles")
      .update({ status: data.status })
      .eq("id", data.id)
      .select()
      .single();
    if (a) {
      await s
        .from("websites")
        .update({ status: data.status })
        .eq("id", a.website_id)
        .in("status", ["ready_for_review", "approved", "action_required"]);
      await log(
        a.campaign_id,
        `Article "${a.title}" ${data.status === "approved" ? "approved" : "moved back to review"}`,
        "info",
        a.website_id,
      );
    }
    return { ok: true };
  });

export const markSubmitted = createServerFn({ method: "POST" })
  .validator((d: { websiteId: string; publicationUrl?: string }) =>
    z
      .object({
        websiteId: z.string().uuid(),
        publicationUrl: z.string().url().optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    const { data: w } = await s.from("websites").select("*").eq("id", data.websiteId).single();
    if (!w) throw new Error("Not found");
    if (
      w.submitted_at &&
      ["submitted", "awaiting_approval", "published"].includes(w.status) &&
      !data.publicationUrl
    ) {
      return { ok: true, duplicate: true }; // duplicate-submission protection
    }
    await s
      .from("websites")
      .update({
        status: data.publicationUrl ? "awaiting_approval" : "submitted",
        submitted_at: w.submitted_at ?? new Date().toISOString(),
        publication_url: data.publicationUrl || w.publication_url,
        stage: "submitted",
      })
      .eq("id", w.id);
    await log(
      w.campaign_id,
      `${w.domain}: marked as submitted${data.publicationUrl ? " — publication URL recorded, awaiting verification" : ""}`,
      "info",
      w.id,
    );
    return { ok: true, duplicate: false };
  });

export const verifyWebsite = createServerFn({ method: "POST" })
  .validator((d: { websiteId: string }) => z.object({ websiteId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    const { data: w } = await s.from("websites").select("*").eq("id", data.websiteId).single();
    if (!w) throw new Error("Website record not found");
    if (!w.publication_url) throw new Error("Add the candidate publication URL first");

    const [{ data: a }, { data: camp }] = await Promise.all([
      s
        .from("articles")
        .select("title,target_url,anchor_text")
        .eq("website_id", w.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      s.from("campaigns").select("config").eq("id", w.campaign_id).single(),
    ]);

    const cfg = (camp?.config ?? {}) as CampaignConfig;
    const target = a?.target_url || w.target_url || cfg.website || "https://afimah.com/";
    const expectedAnchor = a?.anchor_text || w.preferred_anchor || undefined;
    const expectedTitle = a?.title || w.article_title || undefined;

    const { verifyBacklink } = await import("./verification.server");
    const result = await verifyBacklink({
      publishedUrl: w.publication_url,
      targetUrl: target,
      expectedAnchorText: expectedAnchor,
      expectedTitle,
    });

    let newStatus: string = w.status;
    let newStage: string = w.stage;

    if (result.status === "verified") {
      newStatus = "published";
      newStage = "published";
    } else if (result.status === "blocked") {
      newStatus = "blocked";
    } else {
      newStatus = "verification_failed";
    }

    await s
      .from("websites")
      .update({
        verification: result,
        verified_at: result.verifiedAt ?? new Date().toISOString(),
        status: newStatus,
        stage: newStage,
        last_error: result.status === "verified" ? null : result.reason,
      })
      .eq("id", w.id);

    await log(
      w.campaign_id,
      `${w.domain}: Backlink verification [${result.status.toUpperCase()}] — ${result.reason}`,
      result.status === "verified" ? "success" : result.status === "blocked" ? "warn" : "error",
      w.id,
    );

    return result;
  });

export const updateStage = createServerFn({ method: "POST" })
  .validator((d: { id: string; stage: string }) =>
    z.object({ id: z.string().uuid(), stage: z.string().min(1).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    await s.from("websites").update({ stage: data.stage }).eq("id", data.id);
    return { ok: true };
  });

export const exportCampaign = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    const { data: ws } = await s.from("websites").select("*").eq("campaign_id", data.id);
    const { data: as } = await s
      .from("articles")
      .select("website_id,title,anchor_text,target_url,word_count,status")
      .eq("campaign_id", data.id);
    return (ws ?? []).map((w) => {
      const a = as?.find((x) => x.website_id === w.id);
      const v = (w.verification ?? {}) as {
        status?: string;
        finalUrl?: string;
        anchorText?: string;
        relAttributes?: string[];
        reason?: string;
        httpStatus?: number;
      };
      return {
        domain: w.domain,
        url: w.url,
        status: w.status,
        article_title: a?.title ?? "",
        anchor_text: v.anchorText || a?.anchor_text || "",
        target_url: a?.target_url ?? w.target_url ?? "",
        publication_url: w.publication_url ?? "",
        final_url: v.finalUrl ?? w.publication_url ?? "",
        verification_status:
          v.status ??
          (w.status === "published" || w.status === "verified"
            ? "verified"
            : w.status === "verification_failed"
              ? "failed"
              : w.status === "blocked"
                ? "blocked"
                : "unverified"),
        link_rel: (v.relAttributes ?? []).join(", ") || (w.status === "published" || w.status === "verified" ? "dofollow" : ""),
        http_status: v.httpStatus ?? "",
        submitted_at: w.submitted_at ?? "",
        verified_at: w.verified_at ?? "",
        verification_reason: v.reason || w.last_error || "",
      };
    });
  });

export const getOverview = createServerFn({ method: "GET" }).handler(async () => {
  const s = await db();
  const [{ data: ws }, { count }, { data: logs }, { data: campaigns }] = await Promise.all([
    s
      .from("websites")
      .select(
        "id,campaign_id,domain,status,stage,url,publication_url,verification,submitted_at,verified_at,last_error",
      ),
    s.from("articles").select("id", { count: "exact", head: true }),
    s.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(300),
    s
      .from("campaigns")
      .select("id,name,status,created_at")
      .order("created_at", { ascending: false }),
  ]);
  return {
    websites: ws ?? [],
    stats: computeStats(ws ?? [], count ?? 0),
    logs: logs ?? [],
    campaigns: campaigns ?? [],
  };
});

export const getSettingsFn = createServerFn({ method: "GET" }).handler(async () => getSettings());

function normalizePublisherDomain(input: string): string {
  const value = input.trim();
  if (!value || value.length > 253) throw new Error("Enter a valid publisher domain.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error("Enter a valid publisher domain.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
  ) {
    throw new Error("Enter a hostname only, such as publisher.example.");
  }
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export const listPublisherAllowlist = createServerFn({ method: "GET" }).handler(async () => {
  const s = await db();
  const { data, error } = await s
    .from("publisher_allowlist")
    .select("domain,enabled,approved_at")
    .order("domain");
  if (error) throw new Error(`Unable to load approved publishers: ${error.message}`);
  return data ?? [];
});

export const addPublisherToAllowlist = createServerFn({ method: "POST" })
  .validator((d: { domain: string }) =>
    z.object({ domain: z.string().min(1).max(253) }).parse(d),
  )
  .handler(async ({ data }) => {
    const domain = normalizePublisherDomain(data.domain);
    const s = await db();
    const { error } = await s
      .from("publisher_allowlist")
      .upsert({ domain, enabled: true, approved_at: new Date().toISOString() });
    if (error) throw new Error(`Unable to approve publisher: ${error.message}`);
    return { domain };
  });

export const removePublisherFromAllowlist = createServerFn({ method: "POST" })
  .validator((d: { domain: string }) =>
    z.object({ domain: z.string().min(1).max(253) }).parse(d),
  )
  .handler(async ({ data }) => {
    const domain = normalizePublisherDomain(data.domain);
    const s = await db();
    const { error } = await s.from("publisher_allowlist").delete().eq("domain", domain);
    if (error) throw new Error(`Unable to remove publisher approval: ${error.message}`);
    return { domain };
  });

export const getGmailConnectionStatus = createServerFn({ method: "GET" }).handler(async () => {
  const s = await db();
  const { data, error } = await s
    .from("gmail_connections")
    .select("email,connected_at")
    .eq("id", "primary")
    .maybeSingle();
  if (error) throw new Error(`Unable to read Gmail connection status: ${error.message}`);
  const configured = Boolean(
    process.env.GMAIL_OAUTH_CLIENT_ID &&
    process.env.GMAIL_OAUTH_CLIENT_SECRET &&
    process.env.GMAIL_OAUTH_REDIRECT_URI &&
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY,
  );
  return data
    ? { configured, connected: true as const, ...data }
    : { configured, connected: false as const };
});

export const disconnectGmail = createServerFn({ method: "POST" }).handler(async () => {
  const s = await db();
  const { data: existing, error: readError } = await s
    .from("gmail_connections")
    .select("id")
    .eq("id", "primary")
    .maybeSingle();
  if (readError) throw new Error(`Unable to read Gmail connection: ${readError.message}`);
  if (existing) {
    const { revokeGmailAuthorization } = await import("./gmail-oauth.server");
    await revokeGmailAuthorization();
  }
  const { error } = await s.from("gmail_connections").delete().eq("id", "primary");
  if (error) throw new Error(`Unable to disconnect Gmail: ${error.message}`);
  return { connected: false as const };
});

export const saveSettings = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        requestDelayMs: z.number().min(500).max(60000),
        maxAttempts: z.number().min(1).max(10),
        requireApproval: z.boolean(),
        minWords: z.number().min(300).max(3000),
        maxWords: z.number().min(400).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    await s.from("settings").update({ data }).eq("id", 1);
    return data;
  });

export const listTemplates = createServerFn({ method: "GET" }).handler(async () => {
  const s = await db();
  return (await s.from("outreach_templates").select("*").order("created_at")).data ?? [];
});

export const saveTemplate = createServerFn({ method: "POST" })
  .validator((d: { id?: string; name: string; subject: string; body: string }) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(100),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(10000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();
    const row = { name: data.name, subject: data.subject, body: data.body };
    if (data.id) await s.from("outreach_templates").update(row).eq("id", data.id);
    else await s.from("outreach_templates").insert(row);
    return { ok: true };
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await db();
    await s.from("outreach_templates").delete().eq("id", data.id);
    return { ok: true };
  });

/** Returns whether submission credentials are configured (does NOT expose the password). */
export const getSubmissionCredentialStatus = createServerFn({ method: "GET" }).handler(async () => {
  const username = (process.env as Record<string, string | undefined>)["GUEST_POST_USERNAME"] ?? "";
  const password = (process.env as Record<string, string | undefined>)["GUEST_POST_PASSWORD"] ?? "";
  const senderEmail = (process.env as Record<string, string | undefined>)["GMAIL_SENDER_EMAIL"] ?? "";
  const appPassword = (process.env as Record<string, string | undefined>)["GMAIL_APP_PASSWORD"] ?? "";
  return {
    configured: Boolean(username && password),
    username: username || null,
    emailConfigured: Boolean(senderEmail && appPassword),
    senderEmail: senderEmail || null,
  };
});

/** Update submission and Gmail credentials directly from Settings. */
export const saveSubmissionCredentials = createServerFn({ method: "POST" })
  .validator((d: {
    username?: string;
    password?: string;
    senderEmail?: string;
    appPassword?: string;
  }) =>
    z.object({
      username: z.string().optional(),
      password: z.string().optional(),
      senderEmail: z.string().optional(),
      appPassword: z.string().optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    if (data.username !== undefined) (process.env as Record<string, string | undefined>)["GUEST_POST_USERNAME"] = data.username.trim();
    if (data.password !== undefined && data.password.trim()) (process.env as Record<string, string | undefined>)["GUEST_POST_PASSWORD"] = data.password.trim();
    if (data.senderEmail !== undefined) (process.env as Record<string, string | undefined>)["GMAIL_SENDER_EMAIL"] = data.senderEmail.trim();
    if (data.appPassword !== undefined && data.appPassword.trim()) (process.env as Record<string, string | undefined>)["GMAIL_APP_PASSWORD"] = data.appPassword.trim();

    // Persist to .env file
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, "utf-8");
        if (data.username !== undefined) {
          content = content.replace(/^GUEST_POST_USERNAME=.*/m, `GUEST_POST_USERNAME="${data.username.trim()}"`);
        }
        if (data.password !== undefined && data.password.trim()) {
          content = content.replace(/^GUEST_POST_PASSWORD=.*/m, `GUEST_POST_PASSWORD="${data.password.trim()}"`);
        }
        if (data.senderEmail !== undefined) {
          content = content.replace(/^GMAIL_SENDER_EMAIL=.*/m, `GMAIL_SENDER_EMAIL="${data.senderEmail.trim()}"`);
        }
        if (data.appPassword !== undefined && data.appPassword.trim()) {
          content = content.replace(/^GMAIL_APP_PASSWORD=.*/m, `GMAIL_APP_PASSWORD="${data.appPassword.trim()}"`);
        }
        fs.writeFileSync(envPath, content, "utf-8");
      }
    } catch {
      /* non-fatal */
    }

    return { ok: true };
  });

/** Verify the Gmail SMTP / App Password connection is working. */
export const testEmailConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { verifyEmailConnection } = await import("./email.server");
  const result = await verifyEmailConnection();
  return result;
});


// ---------------------------------------------------------------------------
// autoFindPublicationUrl — called from the Backlinks page to search for the
// published post URL for a given website that is in "submitted" state.
// ---------------------------------------------------------------------------
export const autoFindPublicationUrl = createServerFn({ method: "POST" })
  .validator((d: { websiteId: string }) =>
    z.object({ websiteId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await db();

    // Load website record
    const { data: w, error: wErr } = await s
      .from("websites")
      .select("*")
      .eq("id", data.websiteId)
      .single();
    if (wErr || !w) throw new Error("Website not found");

    // Load most recent article for this website
    const { data: art } = await s
      .from("articles")
      .select("title")
      .eq("website_id", w.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const title = (art as { title?: string } | null)?.title ?? "";

    const { findPublishedPost } = await import("./web.server");
    let siteOrigin: string;
    try {
      siteOrigin = new URL(w.url as string).origin;
    } catch {
      return { found: false, url: null };
    }

    const pubUrl = await findPublishedPost(siteOrigin, title, w.url as string).catch(() => null);

    if (pubUrl) {
      const { validateCandidateUrl, verifyBacklink } = await import("./verification.server");
      const validation = validateCandidateUrl(pubUrl);
      if (!validation.valid) {
        return { found: false, url: null, verified: false, reason: validation.reason };
      }

      const { data: camp } = await s.from("campaigns").select("config").eq("id", w.campaign_id).single();
      const cfg = (camp?.config ?? {}) as CampaignConfig;
      const target = (art as { target_url?: string } | null)?.target_url || w.target_url || cfg.website || "https://afimah.com/";
      const expectedAnchor = (art as { anchor_text?: string } | null)?.anchor_text || w.preferred_anchor || undefined;

      const vResult = await verifyBacklink({
        publishedUrl: pubUrl,
        targetUrl: target,
        expectedAnchorText: expectedAnchor,
        expectedTitle: title || undefined,
      });

      const newStatus =
        vResult.status === "verified"
          ? "published"
          : vResult.status === "blocked"
            ? "blocked"
            : "verification_failed";

      await s
        .from("websites")
        .update({
          publication_url: pubUrl,
          status: newStatus,
          stage: vResult.status === "verified" ? "published" : w.stage,
          verification: vResult,
          verified_at: vResult.verifiedAt ?? new Date().toISOString(),
          last_error: vResult.status === "verified" ? null : vResult.reason,
        })
        .eq("id", data.websiteId);

      await log(
        w.campaign_id,
        `${w.domain}: candidate URL found (${pubUrl}) — verification [${vResult.status.toUpperCase()}]: ${vResult.reason}`,
        vResult.status === "verified" ? "success" : "warn",
        w.id,
      );

      return {
        found: true,
        url: pubUrl,
        verified: vResult.status === "verified",
        status: vResult.status,
        reason: vResult.reason,
      };
    }

    return { found: false, url: null, verified: false, reason: "No candidate publication URL found on publisher site" };
  });
