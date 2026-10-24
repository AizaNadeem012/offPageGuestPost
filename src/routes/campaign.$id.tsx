import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getCampaign,
  setCampaignStatus,
  processNext,
  markSubmitted,
  verifyWebsite,
  retryWebsite,
  exportCampaign,
  autoFindPublicationUrl,
} from "@/lib/campaign.functions";
import { StatusBadge, downloadFile } from "@/components/StatusBadge";
import { toCsv } from "@/lib/guestpilot";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Play,
  Pause,
  Ban,
  Download,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Globe,
  FileText,
  Activity,
  RotateCcw,
  Link2,
  Send,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Copy,
  Loader2,
  Check,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/campaign/$id")({
  component: CampaignDetailPage,
});

type CampaignData = Awaited<ReturnType<typeof getCampaign>>;
type Website = CampaignData["websites"][number];
type Log = CampaignData["logs"][number];

function CampaignDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<CampaignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // per-website publication URL inputs
  const [pubUrls, setPubUrls] = useState<Record<string, string>>({});
  const [findingUrls, setFindingUrls] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 25;
  const logsRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);

  const refresh = async () => {
    try {
      const result = await getCampaign({ data: { id } });
      setData(result);
      // pre-fill publication URLs
      const urls: Record<string, string> = {};
      for (const w of result.websites) {
        if (w.publication_url) urls[w.id] = w.publication_url;
      }
      setPubUrls((prev) => ({ ...urls, ...prev }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Initial load
  useEffect(() => {
    refresh().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-run processor when campaign is running
  useEffect(() => {
    if (!data) return;
    if (data.campaign.status !== "running") return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled || processingRef.current) return;
      processingRef.current = true;
      try {
        const result = await processNext({ data: { id } });
        if (cancelled) return;
        // Refresh immediately so the newly parsed website appears in the table right away!
        await refresh();
        if (result.state === "done" || result.state === "paused" || result.state === "idle") {
          return;
        }
        // Schedule next website tick with 1.5s delay
        timeoutId = setTimeout(tick, 1500);
      } catch {
        if (!cancelled) timeoutId = setTimeout(tick, 4000);
      } finally {
        processingRef.current = false;
      }
    };

    timeoutId = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.campaign.status, id]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [data?.logs]);

  const setStatus = async (status: "running" | "paused" | "cancelled") => {
    setBusy(true);
    try {
      await setCampaignStatus({ data: { id, status } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAndVerify = async (websiteId: string) => {
    const url = pubUrls[websiteId]?.trim();
    if (!url) return;
    setBusy(true);
    try {
      await markSubmitted({ data: { websiteId, publicationUrl: url } });
      toast.success("Publication URL recorded! Verifying backlink…");
      const res = await verifyWebsite({ data: { websiteId } });
      if (res.status === "verified") {
        toast.success(`✅ Backlink verified: ${res.reason}`);
      } else if (res.status === "blocked") {
        toast.warning(`⚠️ Verification blocked: ${res.reason}`);
      } else {
        toast.error(`❌ Verification failed: ${res.reason}`);
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAndOpen = (w: Website, article: { title: string; content: string }) => {
    const text = `${article.title}\n\n${article.content}`;
    navigator.clipboard.writeText(text);
    setCopiedId(w.id);
    setTimeout(() => setCopiedId(null), 3000);
    toast.success(`📋 Article copied to clipboard! Opening ${w.domain}…`);
    window.open(w.url, "_blank");
  };

  const handleVerify = async (websiteId: string) => {
    setBusy(true);
    try {
      const res = await verifyWebsite({ data: { websiteId } });
      if (res.status === "verified") {
        toast.success(`✅ Backlink verified: ${res.reason}`);
      } else if (res.status === "blocked") {
        toast.warning(`⚠️ Verification blocked: ${res.reason}`);
      } else {
        toast.error(`❌ Verification failed: ${res.reason}`);
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async (websiteId: string) => {
    setBusy(true);
    try {
      await retryWebsite({ data: { id: websiteId } });
      toast.info("Queued for retry.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAutoFind = async (websiteId: string, domain: string) => {
    setFindingUrls((p) => ({ ...p, [websiteId]: true }));
    try {
      const res = await autoFindPublicationUrl({ data: { websiteId } });
      if (res.found && res.url) {
        setPubUrls((p) => ({ ...p, [websiteId]: res.url! }));
        if (res.verified) {
          toast.success(`🎉 Publication URL auto-detected & verified on ${domain}: ${res.url}`);
        } else {
          toast.warning(`⚠️ URL found on ${domain} (${res.url}), but verification failed: ${res.reason}`);
        }
        await refresh();
      } else {
        toast.info(res.reason ? `Auto-detect: ${res.reason}` : `Could not find published post on ${domain} yet. If you just submitted, please wait a moment or click 'Copy & Open'.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFindingUrls((p) => ({ ...p, [websiteId]: false }));
    }
  };

  const handleExport = async () => {
    try {
      const rows = await exportCampaign({ data: { id } });
      const csv = toCsv(rows);
      downloadFile(`campaign-${id.slice(0, 8)}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading campaign…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">{error}</p>
        <Link to="/campaigns" className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to campaigns
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const { campaign, websites, articles, logs, stats } = data;
  const isRunning = campaign.status === "running";
  const isPaused = campaign.status === "paused";
  const isCancelled = campaign.status === "cancelled";
  const isCompleted = campaign.status === "completed";

  const statusCounts = {
    queued: websites.filter((w) => w.status === "queued").length,
    writing: websites.filter((w) => ["discovering", "writing", "discovered"].includes(w.status)).length,
    submitted: websites.filter((w) =>
      ["submitted", "awaiting_approval", "published_unverified", "awaiting_review", "submission_attempted", "submission_confirmed"].includes(w.status),
    ).length,
    published: websites.filter((w) => w.status === "published" || w.status === "verified").length,
    failed: websites.filter((w) =>
      ["failed", "action_required", "skipped", "verification_failed", "blocked", "rejected"].includes(w.status),
    ).length,
  };

  const totalSites = websites.length;
  const inFlightCount = statusCounts.writing;
  const queuedCount = statusCounts.queued;
  const processedSites = Math.max(0, totalSites - queuedCount - inFlightCount);
  const progressPct = totalSites > 0 ? Math.round((processedSites / totalSites) * 100) : 0;
  const currentlyActive = websites.find((w) => ["discovering", "writing"].includes(w.status));

  const filteredWebsites = websites.filter((w) => {
    if (filter === "queued" && w.status !== "queued") return false;
    if (filter === "writing" && !["discovering", "writing", "discovered"].includes(w.status)) return false;
    if (
      filter === "submitted" &&
      !["submitted", "awaiting_approval", "published_unverified", "awaiting_review", "submission_attempted", "submission_confirmed"].includes(w.status)
    )
      return false;
    if (filter === "published" && w.status !== "published" && w.status !== "verified") return false;
    if (
      filter === "failed" &&
      !["failed", "action_required", "skipped", "verification_failed", "blocked", "rejected"].includes(w.status)
    )
      return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      return w.domain.toLowerCase().includes(q) || w.url.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort websites so that in-flight & recently processed appear at the TOP
  const sortedWebsites = [...filteredWebsites].sort((a, b) => {
    const aInFlight = ["discovering", "writing"].includes(a.status);
    const bInFlight = ["discovering", "writing"].includes(b.status);
    if (aInFlight && !bInFlight) return -1;
    if (!aInFlight && bInFlight) return 1;

    if (a.publication_url && !b.publication_url) return -1;
    if (!a.publication_url && b.publication_url) return 1;

    const aDone = a.status !== "queued";
    const bDone = b.status !== "queued";
    if (aDone && !bDone) return -1;
    if (!aDone && bDone) return 1;

    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sortedWebsites.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedWebsites = sortedWebsites.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-gradient-to-br from-primary/5 via-background to-violet-500/5 px-4 sm:px-6 py-6 lg:px-8">
        <div className="w-full max-w-7xl mx-auto">
          <Link
            to="/campaigns"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="size-3.5" />
            All Campaigns
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-display">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Pause / Resume / Cancel */}
              {isRunning && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void setStatus("paused")}
                  className="gap-2"
                >
                  <Pause className="size-3.5" /> Pause
                </Button>
              )}
              {isPaused && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void setStatus("running")}
                  className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                >
                  <Play className="size-3.5" /> Resume
                </Button>
              )}
              {(isCompleted || isPaused) && !isCancelled && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void setStatus("cancelled")}
                  className="gap-2 text-destructive hover:text-destructive border-destructive/30"
                >
                  <Ban className="size-3.5" /> Cancel
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
                className="gap-2"
              >
                <RefreshCw className="size-3.5" /> Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleExport()}
                className="gap-2"
              >
                <Download className="size-3.5" /> Export CSV
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 lg:px-8 space-y-6">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Live Progress Bar */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium flex items-center gap-2">
              {isRunning && <span className="size-2 rounded-full bg-violet-500 animate-ping" />}
              {isCompleted ? "✅ All websites processed" : isRunning ? "🚀 Agent running — processing websites one by one in real-time…" : isPaused ? "⏸️ Campaign paused" : "Campaign stopped"}
            </span>
            <span className="font-mono text-muted-foreground font-medium">
              {processedSites} / {totalSites} websites completed ({progressPct}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Live Active Website Banner (Shows current web being parsed) */}
        {currentlyActive && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-500/30 bg-violet-500/10 text-xs">
            <Loader2 className="size-4 text-violet-600 dark:text-violet-400 animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-violet-700 dark:text-violet-300">
                Currently Parsing: {currentlyActive.domain}
              </span>
              <span className="text-muted-foreground ml-2">
                Checking guidelines, forum submission forms, and drafting article…
              </span>
            </div>
            <span className="text-[10px] font-mono bg-violet-500/20 text-violet-600 px-2 py-0.5 rounded-full shrink-0">
              Live
            </span>
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Queued", value: statusCounts.queued, color: "text-muted-foreground", bg: "bg-muted/50" },
            { label: "Writing", value: statusCounts.writing, color: "text-violet-500", bg: "bg-violet-500/10" },
            { label: "Submitted", value: statusCounts.submitted, color: "text-indigo-500", bg: "bg-indigo-500/10" },
            { label: "Published", value: statusCounts.published, color: "text-emerald-500", bg: "bg-emerald-500/10" },
            { label: "Issues", value: statusCounts.failed, color: "text-red-500", bg: "bg-red-500/10" },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`rounded-xl border p-3 ${bg} border-border/40`}>
              <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* Website table */}
        <div className="surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-violet-500" />
              <h2 className="text-sm font-medium">Websites ({websites.length})</h2>
              <span className="text-[11px] text-muted-foreground">(Processed websites appear first)</span>
            </div>

            {/* Filter chips & Search */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter domain…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8 pr-2.5 py-1 text-xs rounded-lg border border-border bg-background w-36 sm:w-48 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>

              <div className="flex items-center gap-1 text-xs">
                {[
                  { id: "all", label: "All", count: websites.length },
                  { id: "writing", label: "In Progress", count: statusCounts.writing },
                  { id: "submitted", label: "Submitted", count: statusCounts.submitted },
                  { id: "published", label: "Published", count: statusCounts.published },
                  { id: "failed", label: "Issues", count: statusCounts.failed },
                  { id: "queued", label: "Queued", count: statusCounts.queued },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setFilter(tab.id); setPage(1); }}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      filter === tab.id
                        ? "bg-violet-600 text-white"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-[28%] px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Website & Article</th>
                  <th className="w-[28%] px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Status & Issue Reason</th>
                  <th className="w-[24%] px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Live Post URL</th>
                  <th className="w-[20%] px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {pagedWebsites.map((w) => {
                  const article = articles.find((a) => a.website_id === w.id);
                  const pkg = (w.submission_package ?? {}) as { note?: string };
                  const note = pkg.note ?? null;
                  const canRetry = ["failed", "action_required", "skipped"].includes(w.status);
                  const hasError = !!w.last_error;

                  return (
                    <tr key={w.id} className="hover:bg-muted/20 transition-colors align-top">
                      {/* Website & Article */}
                      <td className="px-3 py-2.5">
                        <div className="space-y-1">
                          <a
                            href={w.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-violet-600 dark:text-violet-400 hover:underline font-semibold break-all"
                          >
                            {w.domain}
                            <ExternalLink className="size-3 shrink-0" />
                          </a>
                          {article ? (
                            <Link
                              to="/article/$id"
                              params={{ id: article.id }}
                              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
                              title={article.title}
                            >
                              <FileText className="size-3 shrink-0 text-violet-500" />
                              <span className="truncate group-hover:underline">{article.title}</span>
                            </Link>
                          ) : (
                            <span className="block text-[11px] text-muted-foreground/50">No article yet</span>
                          )}
                        </div>
                      </td>

                      {/* Status & Issue Reason */}
                      <td className="px-3 py-2.5">
                        <div className="space-y-1.5">
                          <StatusBadge status={w.status} />
                          {hasError ? (
                            <div
                              className="text-[11px] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-1.5 font-sans break-words"
                              title={w.last_error!}
                            >
                              <span className="font-semibold block mb-0.5 flex items-center gap-1">
                                <AlertTriangle className="size-3 shrink-0" /> Issue Reason:
                              </span>
                              <span className="leading-tight">{w.last_error}</span>
                            </div>
                          ) : note ? (
                            <div
                              className={`text-[11px] p-1.5 rounded-md border break-words ${
                                note.includes("⚠️") || note.toLowerCase().includes("error") || note.toLowerCase().includes("failed")
                                  ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20"
                                  : note.includes("✅")
                                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                    : "text-muted-foreground border-border/40 bg-muted/20"
                              }`}
                              title={note}
                            >
                              <p className="leading-tight">{note}</p>
                            </div>
                          ) : null}
                        </div>
                      </td>

                      {/* Live Post URL */}
                      <td className="px-3 py-2.5">
                        {w.publication_url ? (
                          <div className="space-y-1">
                            <a
                              href={w.publication_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-xs text-emerald-600 dark:text-emerald-400 font-semibold hover:underline break-all"
                              title={w.publication_url}
                            >
                              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                              <span className="break-all">{w.publication_url.replace(/^https?:\/\//, "")}</span>
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <input
                              type="url"
                              placeholder="Paste post URL…"
                              value={pubUrls[w.id] ?? ""}
                              onChange={(e) => setPubUrls((prev) => ({ ...prev, [w.id]: e.target.value }))}
                              className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 min-w-0"
                            />
                            {pubUrls[w.id] && (
                              <button
                                disabled={busy}
                                onClick={() => void handleSaveAndVerify(w.id)}
                                className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 transition-colors whitespace-nowrap font-medium shrink-0"
                                title="Save URL"
                              >
                                Save
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Auto-Detect URL button */}
                          {!w.publication_url && (
                            <button
                              disabled={busy || findingUrls[w.id]}
                              onClick={() => void handleAutoFind(w.id, w.domain)}
                              className="rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors flex items-center gap-1 disabled:opacity-50 font-medium"
                              title="Scan site for published post / thread link"
                            >
                              <Sparkles className={`size-3 ${findingUrls[w.id] ? "animate-spin text-violet-500" : ""}`} />
                              {findingUrls[w.id] ? "Detecting…" : "Auto-Detect"}
                            </button>
                          )}

                          {/* 1-Click Copy & Open Forum/Submission Page */}
                          {article && !w.publication_url && (
                            <button
                              onClick={() => handleCopyAndOpen(w, article)}
                              className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground"
                              title="Copy article to clipboard and open forum/submission page"
                            >
                              {copiedId === w.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                              {copiedId === w.id ? "Copied!" : "Copy & Open"}
                            </button>
                          )}

                          {/* Verify Backlink */}
                          {w.publication_url && (
                            <button
                              disabled={busy}
                              onClick={() => void handleVerify(w.id)}
                              className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center gap-1 disabled:opacity-50 font-medium"
                              title="Verify backlink exists on published URL"
                            >
                              <Link2 className="size-3" /> Verify
                            </button>
                          )}

                          {canRetry && (
                            <button
                              disabled={busy}
                              onClick={() => void handleRetry(w.id)}
                              className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors flex items-center gap-1 disabled:opacity-50"
                              title="Retry submission"
                            >
                              <RotateCcw className="size-3" /> Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredWebsites.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No websites match the selected filter.
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {filteredWebsites.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredWebsites.length)} of {filteredWebsites.length} websites
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 px-2 text-xs gap-1"
                >
                  <ChevronLeft className="size-3.5" /> Previous
                </Button>
                <span className="font-mono text-foreground font-medium">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-7 px-2 text-xs gap-1"
                >
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Activity Logs */}
        <div className="surface p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Activity className="size-4 text-violet-500" />
            <h2 className="text-sm font-medium">Activity Log</h2>
            <span className="ml-auto text-xs text-muted-foreground font-mono">
              {logs.length} entries
            </span>
          </div>
          <div
            ref={logsRef}
            className="max-h-64 overflow-y-auto space-y-1.5 pr-1"
          >
            {[...logs].reverse().map((log: Log) => (
              <div key={log.id} className="flex gap-2 text-xs">
                <span
                  className={`mt-1 shrink-0 size-1.5 rounded-full ${
                    log.level === "error"
                      ? "bg-red-500"
                      : log.level === "warn"
                        ? "bg-amber-500"
                        : log.level === "success"
                          ? "bg-emerald-500"
                          : "bg-violet-500"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-muted-foreground leading-relaxed break-words">{log.message}</p>
                  <p className="text-[10px] text-muted-foreground/50 font-mono mt-0.5">
                    {new Date(log.created_at as string).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-xs text-muted-foreground/60 text-center py-4">No activity yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
