import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";

const TEMPLATE = `Campaign Name: Web Dev Authority Campaign
Business Name: Pixel Nest
Website: https://yourwebsite.com
Services: Custom websites, WordPress, E-commerce, Full-stack apps
Target Audience: Small businesses, startups, entrepreneurs
Keywords: web development services, website design, custom website
Anchor Texts: web development services, professional website design
Target URLs: https://yourwebsite.com/services
Tone: Professional, helpful

Article Title: How Small Businesses Can Build an Effective Website

Article Content:
In today's digital world, having a professional website is essential for business success. A well-designed website builds credibility, attracts customers, and drives growth.

## Why Your Business Needs a Professional Website

A professional website serves as your digital storefront, working 24/7 to attract and convert customers. For small businesses, it's often the first impression potential clients have of your brand.

Key benefits include:
- **Credibility**: Professional design builds trust with visitors
- **Visibility**: Search-optimized sites attract organic traffic  
- **Conversion**: Clear calls-to-action turn visitors into customers

## Choosing the Right Web Development Approach

Small businesses often face a choice between template-based solutions and custom development. While templates offer quick deployment, custom websites provide unique branding, better performance, and features tailored to your specific needs.

## Essential Features for Business Websites

Every effective business website should include responsive design for mobile users, fast loading speeds, clear contact information, and easy navigation.

Investing in quality web development pays dividends through increased leads, better brand perception, and a competitive edge in your market.`;

export default function PromptInput({ onChange }: { onChange?: (value: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handle = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    onChange?.(e.target.value);
  };

  const loadTemplate = () => {
    setPrompt(TEMPLATE);
    onChange?.(TEMPLATE);
    setExpanded(true);
  };

  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground" />
        <label className="text-xs font-medium text-foreground">Campaign Brief</label>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{prompt.length} chars</span>
        <button
          type="button"
          onClick={loadTemplate}
          className="text-[10px] text-violet-600 hover:text-violet-500 border border-violet-500/30 rounded px-2 py-0.5 transition-colors"
        >
          Load template
        </button>
      </div>

      <div className="relative">
        <Textarea
          placeholder={"Campaign Name: My Campaign\nBusiness Name: My Brand\nWebsite: https://mybrand.com\nKeywords: your, keywords\n\nArticle Title: Your Article Title\nArticle Content:\n[Paste your article here]"}
          value={prompt}
          onChange={handle}
          rows={expanded ? 14 : 5}
          className="w-full resize-none rounded-lg border-border bg-background/60 font-mono text-xs transition-all focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 leading-relaxed"
        />
        <button
          type="button"
          onClick={() => setExpanded(p => !p)}
          className="absolute bottom-2 right-2 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 bg-background/80 border border-border rounded px-2 py-0.5"
        >
          {expanded ? <><ChevronUp className="size-3" /> Collapse</> : <><ChevronDown className="size-3" /> Expand</>}
        </button>
      </div>
    </section>
  );
}
