import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { StatusBadge } from "@/components/StatusBadge";
import {
  createCampaign,
  getCampaign,
  parseCampaignPrompt,
  processNext,
} from "@/lib/campaign.functions";
import { getManualArticleError, parseManualArticle, type ImportRow } from "@/lib/guestpilot";
import {
  Rocket,
  Globe,
  Mail,
  FileText,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Zap,
  BarChart3,
  Send,
  Link2,
  ChevronRight,
} from "lucide-react";

function getGuidelinesUrl(discovery: unknown): string | null {
  if (
    typeof discovery === "object" &&
    discovery !== null &&
    "guidelinesUrl" in discovery &&
    typeof discovery.guidelinesUrl === "string"
  ) {
    return discovery.guidelinesUrl;
  }
  return null;
}

function requiresHumanVerification(discovery: unknown): boolean {
  return (
    typeof discovery === "object" &&
    discovery !== null &&
    "captchaDetected" in discovery &&
    discovery.captchaDetected === true
  );
}

function getSubmissionNote(pkg: unknown): string | null {
  if (typeof pkg === "object" && pkg !== null && "note" in pkg && typeof pkg.note === "string") {
    return pkg.note || null;
  }
  return null;
}

function getSubmissionMethod(pkg: unknown): string | null {
  if (typeof pkg === "object" && pkg !== null && "method" in pkg && typeof pkg.method === "string") {
    return pkg.method;
  }
  return null;
}

function getSubmissionFeeLabel(discovery: unknown): string | null {
  if (typeof discovery !== "object" || discovery === null || !("submissionFeeSignal" in discovery)) return null;
  switch (discovery.submissionFeeSignal) {
    case "explicitly_free": return "Free submission";
    case "fee_mentioned": return "Fee mentioned — review before proceeding";
    default: return null;
  }
}

const STEPS = ["Parsing brief", "Creating campaign", "Processing websites", "Done"];

export default function CampaignControls({
  prompt,
  rows,
  filename,
  hasImportIssues,
}: {
  prompt: string;
  rows: ImportRow[];
  filename: string;
  hasImportIssues: boolean;
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("");
  const [processed, setProcessed] = useState(0);
  const [results, setResults] = useState<Awaited<ReturnType<typeof getCampaign>> | null>(null);

  const start = async () => {
    if (hasImportIssues) return alert("Fix the spreadsheet issues above first, then re-upload.");
    if (!prompt.trim() || !rows.length) {
      setStatus(!prompt.trim() ? "Campaign brief likhein pehle." : "Website list wali file upload karein.");
      return;
    }
    const articleError = getManualArticleError(parseManualArticle(prompt));
    if (articleError) { setStatus(articleError); return; }

    setLoading(true);
    setStep(0);
    setProcessed(0);
    setResults(null);
    setStatus("");

    try {
      setStep(0);
      setStatus("Parsing campaign brief…");
      const { config, articleTitle, articleContent } = await parseCampaignPrompt({ data: { prompt } });

      setStep(1);
      setStatus("Creating campaign and queueing websites…");
      const campaign = await createCampaign({ data: { prompt, config, articleTitle, articleContent, rows, filename } });

      setStep(2);
      setStatus("Campaign created! Opening Campaign Studio…");
      void navigate({ to: "/campaign/$id", params: { id: campaign.id } });
    } catch (e) {
      setStatus("Error: " + (e instanceof Error ? e.message : String(e)));
      setLoading(false);
    }
  };

  const progressPct = rows.length > 0 ? Math.round((processed / rows.length) * 100) : 0;

  // Summary stats
  const stats = results
    ? {
        submitted: results.websites.filter((w) => ["submitted", "awaiting_approval", "published"].includes(w.status)).length,
        actionRequired: results.websites.filter((w) => w.status === "action_required").length,
        published: results.websites.filter((w) => w.status === "published").length,
        failed: results.websites.filter((w) => w.status === "failed").length,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Launch button */}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          onClick={start}
          disabled={loading}
          size="lg"
          className="relative gap-2 overflow-hidden bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-500/40 hover:scale-[1.02] active:scale-100 disabled:opacity-60 disabled:pointer-events-none"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          {loading ? "Agent Running…" : "Launch Campaign"}
        </Button>

        {rows.length > 0 && !loading && !results && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Globe className="size-3.5" />
            {rows.length} website{rows.length === 1 ? "" : "s"} queued
          </span>
        )}
      </div>

      {/* Progress */}
      {loading && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
          {/* Step indicators */}
          <div className="flex items-center gap-2 text-xs">
            {STEPS.map((s, i) => (
              <span key={s} className="flex items-center gap-1.5">
                {i < step ? (
                  <CheckCircle2 className="size-3.5 text-violet-400" />
                ) : i === step ? (
                  <Loader2 className="size-3.5 animate-spin text-violet-400" />
                ) : (
                  <span className="size-3.5 rounded-full border border-muted-foreground/30" />
                )}
                <span className={i <= step ? "text-foreground" : "text-muted-foreground"}>{s}</span>
                {i < STEPS.length - 1 && <ChevronRight className="size-3 text-muted-foreground/40" />}
              </span>
            ))}
          </div>

          {/* Progress bar */}
          {step === 2 && rows.length > 0 && (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{status}</p>
            </div>
          )}
          {step !== 2 && status && (
            <p className="text-xs text-muted-foreground">{status}</p>
          )}
        </div>
      )}

      {/* Non-loading status message */}
      {!loading && status && !results && (
        <p role="status" className="text-sm text-muted-foreground flex items-center gap-2">
          <Zap className="size-3.5 text-violet-400" />
          {status}
        </p>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {/* Summary stats */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Submitted", value: stats.submitted, icon: Send, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
                { label: "Action Required", value: stats.actionRequired, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
                { label: "Published", value: stats.published, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                { label: "Failed", value: stats.failed, icon: BarChart3, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`rounded-xl border p-3 ${bg}`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`size-4 ${color}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <p className={`mt-1 text-2xl font-bold font-mono ${color}`}>{value}</p>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Results below are submission opportunities. Publication links appear only after a publisher posts your article and you record the URL.
          </p>

          {/* Website cards */}
          <div className="space-y-3">
            {results.websites.map((website) => {
              const guidelinesUrl = getGuidelinesUrl(website.discovery);
              const captchaDetected = requiresHumanVerification(website.discovery);
              const note = getSubmissionNote((website as Record<string, unknown>)["submission_package"]);
              const method = getSubmissionMethod((website as Record<string, unknown>)["submission_package"]);
              const feeLabel = getSubmissionFeeLabel(website.discovery);
              const isSubmitted = ["submitted", "awaiting_approval", "published"].includes(website.status);
              const isActionRequired = website.status === "action_required";

              return (
                <div
                  key={website.id}
                  className={`rounded-xl border p-4 transition-all ${
                    isSubmitted
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : isActionRequired
                        ? "border-amber-500/20 bg-amber-500/5"
                        : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* Left: domain + info */}
                    <div className="min-w-0 space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Globe className="size-4 text-muted-foreground shrink-0" />
                        <span className="font-mono text-sm font-medium">{website.domain}</span>
                        {method && (
                          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {method === "email" ? <Mail className="size-3" /> : method === "form" ? <FileText className="size-3" /> : <Link2 className="size-3" />}
                            {method}
                          </span>
                        )}
                      </div>

                      {/* CAPTCHA warning */}
                      {captchaDetected && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                          CAPTCHA detected — please submit manually on the publisher site.
                        </div>
                      )}

                      {/* Submission note */}
                      {note && (
                        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                          note.startsWith("✅")
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : note.includes("⚠️") || note.includes("CAPTCHA") || note.includes("manual")
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "border-border bg-muted/50 text-muted-foreground"
                        }`}>
                          <span className="shrink-0 mt-0.5">
                            {note.startsWith("✅") ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                          </span>
                          {note}
                        </div>
                      )}

                      {/* Guidelines link */}
                      {guidelinesUrl && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={guidelinesUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors"
                          >
                            <ExternalLink className="size-3" />
                            Submission page
                          </a>
                          {feeLabel && (
                            <span className="text-xs text-muted-foreground">{feeLabel}</span>
                          )}
                        </div>
                      )}

                      {/* Publication URL */}
                      {website.publication_url && (
                        <a
                          href={website.publication_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 underline hover:no-underline"
                        >
                          <CheckCircle2 className="size-3" />
                          Published article URL
                        </a>
                      )}
                    </div>

                    {/* Right: status badge */}
                    <StatusBadge status={website.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
