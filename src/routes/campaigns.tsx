import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listCampaigns } from "@/lib/campaign.functions";
import { StatusBadge } from "@/components/StatusBadge";
import { FileText, Plus, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/campaigns")({
  component: CampaignsPage,
});

type Campaign = Awaited<ReturnType<typeof listCampaigns>>[number];

function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listCampaigns()
      .then(setCampaigns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-border bg-gradient-to-br from-primary/5 via-background to-violet-500/5 px-6 py-8 lg:px-10">
        <div className="flex items-center justify-between max-w-5xl">
          <div>
            <h1 className="text-2xl font-display">All Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              View and manage all your guest post campaigns.
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 transition-all hover:scale-[1.02]"
          >
            <Plus className="size-4" />
            New Campaign
          </Link>
        </div>
      </div>

      <div className="px-6 py-8 lg:px-10 max-w-5xl">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4">
            {error}
          </p>
        )}

        {loading ? (
          <div className="surface p-8 text-center text-muted-foreground text-sm">
            Loading campaigns…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="surface p-12 text-center space-y-3">
            <FileText className="size-10 mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground">No campaigns yet.</p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="size-4" />
              Create your first campaign
            </Link>
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Campaign Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate max-w-xs">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status as string} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {new Date(c.created_at as string).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to="/campaign/$id"
                        params={{ id: c.id }}
                        className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors"
                      >
                        View <ChevronRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
