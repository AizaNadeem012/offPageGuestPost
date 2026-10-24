CREATE TABLE public.publisher_allowlist (
  domain text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gmail_connections (
  id text PRIMARY KEY CHECK (id = 'primary'),
  email text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  refresh_token_iv text NOT NULL,
  refresh_token_tag text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.publisher_allowlist TO service_role;
GRANT ALL ON public.gmail_connections TO service_role;
ALTER TABLE public.publisher_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;
