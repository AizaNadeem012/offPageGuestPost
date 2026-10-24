import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getArticle, saveArticle, setArticleStatus } from "@/lib/campaign.functions";
import { wordCount } from "@/lib/guestpilot";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  RotateCcw,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/article/$id")({
  component: ArticleEditorPage,
});

type ArticleData = Awaited<ReturnType<typeof getArticle>>;
type Revision = ArticleData["revisions"][number];

function ArticleEditorPage() {
  const { id } = Route.useParams();
  const [data, setData] = useState<ArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [settingStatus, setSettingStatus] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [showRevisions, setShowRevisions] = useState(false);

  const refresh = async () => {
    try {
      const result = await getArticle({ data: { id } });
      setData(result);
      setTitle(result.article.title);
      setContent(result.article.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const result = await saveArticle({ data: { id, title, content } });
      setSaveMsg(`✅ Saved (v${result.version})`);
      await refresh();
    } catch (e) {
      setSaveMsg("❌ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleStatusToggle = async () => {
    if (!data) return;
    setSettingStatus(true);
    try {
      const newStatus =
        data.article.status === "approved" ? "ready_for_review" : "approved";
      await setArticleStatus({ data: { id, status: newStatus } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading article…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { article, website, campaign } = data;
  const wc = wordCount(content);
  const isApproved = article.status === "approved";

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-gradient-to-br from-primary/5 via-background to-violet-500/5 px-6 py-6 lg:px-10">
        {campaign && (
          <Link
            to="/campaign/$id"
            params={{ id: campaign.id }}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="size-3.5" />
            Back to Campaign: {campaign.name}
          </Link>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="size-5 text-violet-500" />
            <div>
              <h1 className="text-lg font-display">Article Editor</h1>
              {website && (
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{website.domain}</p>
              )}
            </div>
            <StatusBadge status={article.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={settingStatus}
              onClick={() => void handleStatusToggle()}
              className={`gap-2 ${
                isApproved
                  ? "text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                  : "text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
              }`}
            >
              {isApproved ? (
                <><RotateCcw className="size-3.5" /> Send to Review</>
              ) : (
                <><CheckCircle2 className="size-3.5" /> Approve</>
              )}
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
              className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              <Save className="size-3.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        {saveMsg && (
          <p className={`mt-2 text-xs ${saveMsg.startsWith("✅") ? "text-emerald-600" : "text-destructive"}`}>
            {saveMsg}
          </p>
        )}
      </div>

      <div className="px-6 py-6 lg:px-10 max-w-4xl space-y-4">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Title */}
        <div className="surface p-4 space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Article title…"
          />
        </div>

        {/* Content */}
        <div className="surface p-4 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Content
            </label>
            <span className="text-xs font-mono text-muted-foreground">
              {wc.toLocaleString()} words
            </span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={24}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Article content…"
          />
        </div>

        {/* Revision history */}
        <div className="surface overflow-hidden">
          <button
            onClick={() => setShowRevisions((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
          >
            <Clock className="size-4 text-violet-500" />
            Revision History ({data.revisions.length})
            <span className="ml-auto">
              {showRevisions ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </span>
          </button>
          {showRevisions && (
            <div className="border-t border-border divide-y divide-border/50">
              {data.revisions.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No revisions yet.</p>
              ) : (
                data.revisions.map((rev: Revision) => (
                  <div key={rev.id} className="px-4 py-3 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-violet-500">v{rev.version}</span>
                      <span className="text-xs font-medium truncate flex-1">{rev.title}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/60">
                        {new Date(rev.created_at as string).toLocaleString()}
                      </span>
                    </div>
                    {rev.note && (
                      <p className="text-xs text-muted-foreground">{rev.note}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
