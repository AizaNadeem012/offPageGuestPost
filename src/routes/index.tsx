import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import PromptInput from "@/components/PromptInput";
import FileUploader from "@/components/FileUploader";
import CampaignControls from "@/components/CampaignControls";
import { StatusBadge } from "@/components/StatusBadge";
import type { ImportIssue, ImportRow } from "@/lib/guestpilot";
import { getOverview } from "@/lib/campaign.functions";
import {
  Globe, Send, CheckCircle2, AlertTriangle, FileText,
  Clock, TrendingUp, Activity, ChevronRight, Link2,
} from "lucide-react";

export const Route = createFileRoute("/")(({ component: Dashboard }));

function Dashboard() {
  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filename, setFilename] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof getOverview>> | null>(null);

  useEffect(() => {
    getOverview().then(setOverview).catch(() => {});
    const t = setInterval(() => getOverview().then(setOverview).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, []);

  const handleFile = async (file: File) => {
    setUploadStatus("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setRows(data.rows);
      setFilename(data.filename);
      setIssues(data.issues ?? []);
      const n = data.issues?.length ?? 0;
      setUploadStatus(`✅ ${data.filename}: ${data.rows.length} websites${n ? `, ${n} issue${n === 1 ? "" : "s"}` : ""}`);
    } catch (err) {
      setRows([]); setFilename(""); setIssues([]);
      setUploadStatus(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const s = overview?.stats;
  const statCards = s ? [
    { label: "Total Sites",   value: s.total,          icon: Globe,         color: "text-slate-600",   bg: "bg-slate-500/8 border-slate-500/20" },
    { label: "Submitted",     value: s.submissions,     icon: Send,          color: "text-violet-600",  bg: "bg-violet-500/8 border-violet-500/20" },
    { label: "Published",     value: s.verified,        icon: CheckCircle2,  color: "text-emerald-600", bg: "bg-emerald-500/8 border-emerald-500/20" },
    { label: "Pending",       value: s.pending,         icon: Clock,         color: "text-amber-600",   bg: "bg-amber-500/8 border-amber-500/20" },
    { label: "Action Needed", value: s.failures,        icon: AlertTriangle, color: "text-orange-600",  bg: "bg-orange-500/8 border-orange-500/20" },
  ] : [];

  return (
    <div className="px-6 py-5 lg:px-8 space-y-5 max-w-7xl">

      {/* Stats row */}
      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {statCards.map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`flex items-center gap-3 rounded-xl border p-3.5 ${bg}`}>
              <Icon className={`size-4 ${color} shrink-0`} />
              <div>
                <p className={`text-xl font-bold font-mono leading-none ${color}`}>{value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">

        {/* Left: New Campaign */}
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/20">
            <Send className="size-4 text-violet-500" />
            <h2 className="text-sm font-semibold">New Campaign</h2>
          </div>
          <div className="p-5 space-y-4">
            <PromptInput onChange={setPrompt} />
            <FileUploader onFileSelect={handleFile} />

            {uploadStatus && (
              <p className={`text-xs flex items-center gap-1.5 ${uploadStatus.startsWith("❌") ? "text-destructive" : "text-muted-foreground"}`}>
                {uploadStatus}
              </p>
            )}

            {issues.length > 0 && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3.5" />
                  {issues.length} spreadsheet issue{issues.length === 1 ? "" : "s"}
                </div>
                <ul className="space-y-0.5 text-xs text-destructive/70">
                  {issues.slice(0, 6).map(i => (
                    <li key={`${i.row}-${i.reason}`}>{i.row ? `Row ${i.row}: ` : ""}{i.reason}</li>
                  ))}
                  {issues.length > 6 && <li>…and {issues.length - 6} more</li>}
                </ul>
              </div>
            )}

            <div className="border-t border-border pt-4">
              <CampaignControls prompt={prompt} rows={rows} filename={filename} hasImportIssues={issues.length > 0} />
            </div>
          </div>
        </div>

        {/* Right: Activity + Campaigns + Backlinks */}
        <div className="space-y-4">

          {/* Live Activity */}
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
              <Activity className="size-3.5 text-violet-500" />
              <h2 className="text-xs font-semibold">Live Activity</h2>
              <span className="ml-auto relative flex size-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-violet-500" />
              </span>
            </div>
            <div className="px-4 py-3">
              {overview?.logs && overview.logs.length > 0 ? (
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {overview.logs.slice(0, 15).map(log => (
                    <li key={log.id} className="flex gap-2 text-xs">
                      <span className={`mt-1 shrink-0 size-1.5 rounded-full ${
                        log.level === "error" ? "bg-red-500" : log.level === "warn" ? "bg-amber-500" : log.level === "success" ? "bg-emerald-500" : "bg-violet-400"
                      }`} />
                      <div className="min-w-0">
                        <p className="text-muted-foreground leading-relaxed break-words">{log.message}</p>
                        <p className="text-[10px] text-muted-foreground/40 font-mono">{new Date(log.created_at as string).toLocaleTimeString()}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-center text-muted-foreground py-6">No activity yet — launch a campaign</p>
              )}
            </div>
          </div>

          {/* Recent Campaigns */}
          {overview?.campaigns && overview.campaigns.length > 0 && (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20">
                <TrendingUp className="size-3.5 text-violet-500" />
                <h2 className="text-xs font-semibold">Recent Campaigns</h2>
                <Link to="/campaigns" className="ml-auto text-[11px] text-violet-500 hover:text-violet-400 flex items-center gap-0.5">
                  All <ChevronRight className="size-3" />
                </Link>
              </div>
              <ul className="divide-y divide-border">
                {overview.campaigns.slice(0, 4).map(c => (
                  <li key={c.id}>
                    <Link to="/campaign/$id" params={{ id: c.id }} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                      <FileText className="size-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{new Date(c.created_at as string).toLocaleDateString()}</p>
                      </div>
                      <StatusBadge status={c.status as string} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verified Backlinks Quick View */}
          {overview?.websites && (overview.websites as {status:string;domain:string;publication_url:string|null}[]).some(w => w.status === "published") && (
            <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-emerald-500/20">
                <Link2 className="size-3.5 text-emerald-600" />
                <h2 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Verified Backlinks</h2>
                <Link to="/backlinks" className="ml-auto text-[11px] text-emerald-600 hover:text-emerald-500 flex items-center gap-0.5">
                  View all <ChevronRight className="size-3" />
                </Link>
              </div>
              <ul className="divide-y divide-emerald-500/10">
                {(overview.websites as {status:string;domain:string;publication_url:string|null;id:string}[])
                  .filter(w => w.status === "published")
                  .slice(0, 4)
                  .map(w => (
                    <li key={w.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-xs font-medium">{w.domain}</span>
                      {w.publication_url && (
                        <a href={w.publication_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-emerald-600 hover:underline flex items-center gap-0.5">
                          View ↗
                        </a>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
