import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getOverview, markSubmitted, autoFindPublicationUrl, verifyWebsite } from "@/lib/campaign.functions";
import { StatusBadge } from "@/components/StatusBadge";
import { toCsv } from "@/lib/guestpilot";
import {
  Link2, CheckCircle2, Clock, AlertTriangle,
  Download, RefreshCw, ExternalLink, ChevronDown, ChevronUp, Search, ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/backlinks")({
  component: BacklinksPage,
});

type Website = {
  id: string; domain: string; url: string; status: string;
  campaign_id: string; publication_url: string | null;
  verification: unknown; submitted_at: string | null;
  verified_at: string | null; last_error: string | null;
};
type Campaign = { id: string; name: string; status: string; created_at: unknown };
type Vdata = {
  status?: string;
  finalUrl?: string;
  anchorText?: string;
  targetUrl?: string;
  relAttributes?: string[];
  httpStatus?: number | null;
  reason?: string;
  // legacy fallback
  links?: { rel: string; href: string; anchor: string }[];
  target?: string;
};

function getV(w: Website): Vdata { return (w.verification ?? {}) as Vdata; }

function BacklinksPage() {
  const [data, setData] = useState<{ websites: Website[]; campaigns: Campaign[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pubInputs, setPubInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [autoFinding, setAutoFinding] = useState<Record<string, boolean>>({});
  const [autoFindResult, setAutoFindResult] = useState<Record<string, { found: boolean; url: string | null; verified?: boolean; reason?: string }>>({});

  const load = () => {
    getOverview().then((d) => {
      setData({ websites: d.websites as Website[], campaigns: d.campaigns as Campaign[] });
      setLoading(false);
    }).catch(() => setLoading(false));
    setLoading(true);
  };

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const toggle = (k: string) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  const websites = data?.websites ?? [];
  const campaigns = data?.campaigns ?? [];
  const cMap = Object.fromEntries(campaigns.map(c => [c.id, c.name]));

  const published = websites.filter(w => w.status === "published" || w.status === "verified");
  const pending = websites.filter(w => ["submitted", "awaiting_approval", "published_unverified", "awaiting_review", "submission_attempted", "submission_confirmed"].includes(w.status));
  const actionReq = websites.filter(w => ["action_required", "failed", "skipped", "verification_failed", "blocked", "rejected"].includes(w.status));

  const dl = (rows: Website[], name: string) => {
    const csv = toCsv(rows.map(w => {
      const v = getV(w);
      const isVerified = w.status === "published" || w.status === "verified";
      return {
        Domain: w.domain,
        Status: w.status,
        "Publication URL": w.publication_url ?? "",
        "Final URL": v.finalUrl || w.publication_url || "",
        "Link Rel": (v.relAttributes && v.relAttributes.length ? v.relAttributes.join(", ") : null) || v.links?.[0]?.rel || (isVerified ? "dofollow" : ""),
        "Anchor Text": v.anchorText || v.links?.[0]?.anchor || "",
        "Target URL": v.targetUrl || v.target || "https://afimah.com/",
        "Verification Status": v.status || (isVerified ? "verified" : w.status === "verification_failed" ? "failed" : w.status === "blocked" ? "blocked" : "unverified"),
        "Verified At": w.verified_at ?? "",
        "Verification Reason": v.reason || w.last_error || "",
        Campaign: cMap[w.campaign_id] ?? "",
      };
    }));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const savePubUrl = async (w: Website) => {
    const url = pubInputs[w.id] ?? w.publication_url ?? "";
    if (!url) return;
    setSaving(p => ({ ...p, [w.id]: true }));
    try {
      await markSubmitted({ data: { websiteId: w.id, publicationUrl: url } });
      await verifyWebsite({ data: { websiteId: w.id } }).catch(() => {});
      load();
    } finally {
      setSaving(p => ({ ...p, [w.id]: false }));
    }
  };

  const runVerify = async (w: Website) => {
    setVerifying(p => ({ ...p, [w.id]: true }));
    try {
      await verifyWebsite({ data: { websiteId: w.id } });
      load();
    } finally {
      setVerifying(p => ({ ...p, [w.id]: false }));
    }
  };

  const runAutoFind = async (w: Website) => {
    setAutoFinding(p => ({ ...p, [w.id]: true }));
    setAutoFindResult(p => ({ ...p, [w.id]: { found: false, url: null } }));
    try {
      const res = await autoFindPublicationUrl({ data: { websiteId: w.id } });
      setAutoFindResult(p => ({ ...p, [w.id]: res }));
      load(); // autoFindPublicationUrl already runs verifyBacklink and updates database
    } finally {
      setAutoFinding(p => ({ ...p, [w.id]: false }));
    }
  };

  const Section = ({ id, title, icon: Icon, color, count, children }: {
    id: string; title: string; icon: React.ElementType; color: string; count: number; children: React.ReactNode;
  }) => (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <button
        onClick={() => toggle(id)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Icon className={`size-4 ${color}`} />
          <span className="font-medium text-sm">{title}</span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${color.replace("text-", "bg-").replace("600", "500/10")} ${color}`}>
            {count}
          </span>
        </div>
        {collapsed[id] ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronUp className="size-4 text-muted-foreground" />}
      </button>
      {!collapsed[id] && <div className="border-t border-border">{children}</div>}
    </div>
  );

  return (
    <div className="px-6 py-6 lg:px-8 max-w-7xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Link2 className="size-5 text-violet-500" /> Backlinks & Approvals
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Strict evidence-based backlink verification & monitoring · auto-refreshes every 30s</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors">
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Verified Backlinks", value: published.length, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-500/8 border-emerald-500/20" },
          { label: "Pending Verification", value: pending.length, icon: Clock, color: "text-violet-600", bg: "bg-violet-500/8 border-violet-500/20" },
          { label: "Action / Issues", value: actionReq.length, icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-500/8 border-orange-500/20" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className={`flex items-center gap-3 rounded-xl border p-4 ${bg}`}>
            <Icon className={`size-5 ${color} shrink-0`} />
            <div>
              <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Section A — Verified */}
      <Section id="pub" title="Verified Backlinks" icon={CheckCircle2} color="text-emerald-600" count={published.length}>
        {published.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No verified backlinks yet. When candidate publication URLs pass strict backlink verification, they will be listed here.</p>
        ) : (
          <>
            <div className="flex justify-end px-4 py-2 border-b border-border bg-muted/20">
              <button onClick={() => dl(published, "verified-backlinks")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Download className="size-3" /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/20">
                  <tr>{["Domain", "Publication URL", "Anchor Text", "Link Type", "Campaign", "Verified", "Actions"].map(h => <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {published.map(w => {
                    const v = getV(w);
                    const rel = (v.relAttributes && v.relAttributes.length ? v.relAttributes.join(", ") : null) || v.links?.[0]?.rel || "dofollow";
                    const isNofollow = rel.includes("nofollow");
                    return (
                      <tr key={w.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 font-medium text-sm">{w.domain}</td>
                        <td className="px-4 py-3">
                          {w.publication_url
                            ? <a href={w.publication_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-violet-600 hover:underline text-xs max-w-[200px] truncate">{w.publication_url.replace(/^https?:\/\//, "")} <ExternalLink className="size-3 shrink-0" /></a>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{v.anchorText || v.links?.[0]?.anchor || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-md font-medium ${isNofollow ? "bg-orange-500/10 text-orange-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                            {rel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{cMap[w.campaign_id] || "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{w.verified_at ? new Date(w.verified_at).toLocaleDateString() : "—"}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => runVerify(w)}
                            disabled={verifying[w.id]}
                            className="inline-flex items-center gap-1 text-[11px] border border-border text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
                            title="Re-verify backlink"
                          >
                            <ShieldCheck className="size-3" />
                            {verifying[w.id] ? "Checking…" : "Recheck"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* Section B — Pending */}
      <Section id="pend" title="Pending Approvals & Verification" icon={Clock} color="text-violet-600" count={pending.length}>
        {pending.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No pending posts awaiting verification.</p>
        ) : (
          <>
            <div className="flex justify-end px-4 py-2 border-b border-border bg-muted/20">
              <button onClick={() => dl(pending, "pending-approvals")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Download className="size-3" /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/20">
                  <tr>{["Domain", "Status", "Submitted", "Candidate URL", "Auto-Detect & Verify", "Campaign"].map(h => <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pending.map(w => (
                    <tr key={w.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-sm">
                        <a href={w.url} target="_blank" rel="noopener noreferrer" className="hover:underline text-violet-600">{w.domain}</a>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={w.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{w.submitted_at ? new Date(w.submitted_at).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="url"
                            placeholder="https://site.com/my-post"
                            value={pubInputs[w.id] ?? w.publication_url ?? ""}
                            onChange={e => setPubInputs(p => ({ ...p, [w.id]: e.target.value }))}
                            className="text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background w-44 focus:outline-none focus:ring-1 focus:ring-violet-500"
                          />
                          <button
                            onClick={() => savePubUrl(w)}
                            disabled={saving[w.id]}
                            className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                          >
                            {saving[w.id] ? "…" : "Save & Verify"}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => runAutoFind(w)}
                            disabled={autoFinding[w.id]}
                            className="inline-flex items-center gap-1 text-xs border border-violet-500/40 text-violet-600 px-2.5 py-1 rounded-lg hover:bg-violet-500/5 disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            <Search className={`size-3 ${autoFinding[w.id] ? "animate-spin" : ""}`} />
                            {autoFinding[w.id] ? "Searching & Verifying…" : "Auto-Detect URL"}
                          </button>
                          {autoFindResult[w.id] && (
                            <span className={`text-[10px] font-mono ${autoFindResult[w.id].verified ? "text-emerald-600" : autoFindResult[w.id].found ? "text-amber-600" : "text-muted-foreground"}`}>
                              {autoFindResult[w.id].verified
                                ? `✅ Verified: ${(autoFindResult[w.id].url ?? "").replace(/^https?:\/\//, "").slice(0, 30)}…`
                                : autoFindResult[w.id].found
                                  ? `⚠️ Found: ${autoFindResult[w.id].reason || "Verification failed"}`
                                  : `❌ Not found: ${autoFindResult[w.id].reason || "No post detected"}`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{cMap[w.campaign_id] || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* Section C — Action Required / Verification Issues */}
      <Section id="act" title="Action Required / Issues" icon={AlertTriangle} color="text-orange-600" count={actionReq.length}>
        {actionReq.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No verification failures or action items. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/20">
                <tr>{["Domain", "Status", "Issue Reason", "Candidate URL", "Campaign", "Actions"].map(h => <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {actionReq.map(w => {
                  const v = getV(w);
                  return (
                    <tr key={w.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-sm text-orange-600">{w.domain}</td>
                      <td className="px-4 py-3"><StatusBadge status={w.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[280px]">
                        {v.reason || w.last_error || "Manual intervention required"}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono max-w-[180px] truncate">
                        {w.publication_url ? (
                          <a href={w.publication_url} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:underline">
                            {w.publication_url.replace(/^https?:\/\//, "")}
                          </a>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{cMap[w.campaign_id] || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {w.publication_url && (
                            <button
                              onClick={() => runVerify(w)}
                              disabled={verifying[w.id]}
                              className="inline-flex items-center gap-1 text-xs border border-violet-500/30 rounded-lg px-2.5 py-1 text-violet-600 hover:bg-violet-500/5 transition-colors disabled:opacity-50"
                            >
                              <ShieldCheck className="size-3" />
                              {verifying[w.id] ? "Verifying…" : "Recheck"}
                            </button>
                          )}
                          <a href={w.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-lg px-2.5 py-1 hover:bg-muted transition-colors">
                            Visit <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Back to campaigns */}
      <div className="text-center pt-2">
        <Link to="/campaigns" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          ← View all campaigns
        </Link>
      </div>
    </div>
  );
}
