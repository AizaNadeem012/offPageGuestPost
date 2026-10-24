CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Untitled campaign',
  prompt text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_info jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  source_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  url text NOT NULL,
  domain text NOT NULL,
  category text, login_url text, preferred_anchor text, target_url text,
  priority int NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'prospect',
  discovery jsonb NOT NULL DEFAULT '{}'::jsonb,
  submission_package jsonb,
  publication_url text,
  verification jsonb,
  verified_at timestamptz,
  submitted_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, domain)
);
CREATE INDEX websites_campaign_status ON public.websites(campaign_id, status);
CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  anchor_text text, target_url text,
  word_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX articles_website ON public.articles(website_id);
CREATE TABLE public.article_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  version int NOT NULL, title text NOT NULL, content text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE,
  website_id uuid REFERENCES public.websites(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_campaign ON public.activity_logs(campaign_id, created_at DESC);
CREATE TABLE public.outreach_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL DEFAULT '{"requestDelayMs":2000,"maxAttempts":3,"requireApproval":true,"minWords":900,"maxWords":1400}'::jsonb
);
INSERT INTO public.settings(id) VALUES (1);
INSERT INTO public.outreach_templates(name,subject,body) VALUES
('Guest post pitch','Guest post idea for {{site}}','Hi {{site}} team,\n\nI''d love to contribute an original article titled "{{title}}" for your readers. It is written to your guidelines and includes no promotional fluff.\n\nWould you be open to reviewing it?\n\nBest,\n{{brand}}');
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['campaigns','websites','articles','article_revisions','activity_logs','outreach_templates','settings'] LOOP
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
END LOOP; END $$;