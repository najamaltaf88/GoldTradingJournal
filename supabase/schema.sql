-- XAUUSD Journal — run in Supabase SQL Editor

-- Accounts table (composite PK: logical account id is per-user, e.g. "main")
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Main Account',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date TEXT,
  session TEXT,
  entry TEXT,
  level TEXT,
  tf TEXT,
  setup TEXT,
  mistake TEXT,
  hold TEXT,
  market_condition TEXT,
  bias_alignment TEXT,
  confirmation_type TEXT,
  sl_tp_placement TEXT,
  tp_placement TEXT,
  patience_score TEXT,
  risk TEXT,
  reward TEXT,
  result TEXT,
  reason TEXT,
  screenshot_url TEXT,
  pnl NUMERIC,
  cum NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cash transactions table
CREATE TABLE IF NOT EXISTS cash_transactions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date TEXT,
  type TEXT,
  amount NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skipped trades table
CREATE TABLE IF NOT EXISTS skipped_trades (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date TEXT,
  session TEXT,
  level TEXT,
  tf TEXT,
  direction TEXT,
  skip_reason TEXT,
  confidence TEXT,
  notes TEXT,
  outcome TEXT,
  pips_missed TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weekly reviews table
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  week_of TEXT,
  learned TEXT,
  pattern TEXT,
  improve TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Journal options and settings (one row per user per account)
-- Note: id format is '{user_id}_{account_id}' to ensure global uniqueness
-- If migrating existing data: UPDATE journal_meta SET id = user_id || '_' || account_id;
CREATE TABLE IF NOT EXISTS journal_meta (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  options JSONB DEFAULT '{}',
  settings JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for older installs that created accounts with PRIMARY KEY (id)
-- and child tables referencing only account_id. This rebuilds account
-- ownership as (user_id, account_id), which matches the app and RLS rules.
DO $$
DECLARE
  old_fk RECORD;
  old_pk TEXT;
BEGIN
  -- Old foreign keys depend on accounts_pkey, so remove them before changing
  -- the accounts primary key. Constraint names may differ between installs.
  FOR old_fk IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.accounts'::regclass
      AND conrelid IN (
        'public.trades'::regclass,
        'public.cash_transactions'::regclass,
        'public.skipped_trades'::regclass,
        'public.weekly_reviews'::regclass,
        'public.journal_meta'::regclass
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', old_fk.table_name, old_fk.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, id)'
  ) THEN
    SELECT conname INTO old_pk
    FROM pg_constraint
    WHERE conrelid = 'public.accounts'::regclass
      AND contype = 'p'
    LIMIT 1;

    IF old_pk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.accounts DROP CONSTRAINT %I', old_pk);
    END IF;

    ALTER TABLE public.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (user_id, id);
  END IF;

  -- Make sure every existing child row has a matching per-user account row
  -- before adding composite foreign keys.
  INSERT INTO public.accounts (id, user_id, name, created_at, updated_at)
  SELECT DISTINCT account_id, user_id, 'Main Account', NOW(), NOW()
  FROM (
    SELECT account_id, user_id FROM public.trades
    UNION
    SELECT account_id, user_id FROM public.cash_transactions
    UNION
    SELECT account_id, user_id FROM public.skipped_trades
    UNION
    SELECT account_id, user_id FROM public.weekly_reviews
    UNION
    SELECT account_id, user_id FROM public.journal_meta
  ) child_accounts
  WHERE account_id IS NOT NULL
    AND user_id IS NOT NULL
  ON CONFLICT (user_id, id) DO NOTHING;

  ALTER TABLE public.trades
    ADD CONSTRAINT trades_account_id_fkey
    FOREIGN KEY (user_id, account_id)
    REFERENCES public.accounts(user_id, id)
    ON DELETE CASCADE;

  ALTER TABLE public.cash_transactions
    ADD CONSTRAINT cash_transactions_account_id_fkey
    FOREIGN KEY (user_id, account_id)
    REFERENCES public.accounts(user_id, id)
    ON DELETE CASCADE;

  ALTER TABLE public.skipped_trades
    ADD CONSTRAINT skipped_trades_account_id_fkey
    FOREIGN KEY (user_id, account_id)
    REFERENCES public.accounts(user_id, id)
    ON DELETE CASCADE;

  ALTER TABLE public.weekly_reviews
    ADD CONSTRAINT weekly_reviews_account_id_fkey
    FOREIGN KEY (user_id, account_id)
    REFERENCES public.accounts(user_id, id)
    ON DELETE CASCADE;

  ALTER TABLE public.journal_meta
    ADD CONSTRAINT journal_meta_account_id_fkey
    FOREIGN KEY (user_id, account_id)
    REFERENCES public.accounts(user_id, id)
    ON DELETE CASCADE;
END $$;

-- Enable Row Level Security on all tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skipped_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_meta ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only see and write their own data
DROP POLICY IF EXISTS "Users own accounts" ON accounts;
DROP POLICY IF EXISTS "Users own trades" ON trades;
DROP POLICY IF EXISTS "Users own cash_transactions" ON cash_transactions;
DROP POLICY IF EXISTS "Users own skipped_trades" ON skipped_trades;
DROP POLICY IF EXISTS "Users own weekly_reviews" ON weekly_reviews;
DROP POLICY IF EXISTS "Users own journal_meta" ON journal_meta;
DROP POLICY IF EXISTS "Users upload own screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Public screenshot read" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own screenshots" ON storage.objects;

CREATE POLICY "Users own accounts" ON accounts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own trades" ON trades FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own cash_transactions" ON cash_transactions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own skipped_trades" ON skipped_trades FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own weekly_reviews" ON weekly_reviews FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users own journal_meta" ON journal_meta FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Storage bucket (create "screenshots" bucket as public in Dashboard, 5MB limit)
INSERT INTO storage.buckets (id, name, public) VALUES ('screenshots', 'screenshots', true) ON CONFLICT DO NOTHING;

CREATE POLICY "Users upload own screenshots" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public screenshot read" ON storage.objects
FOR SELECT USING (bucket_id = 'screenshots');

CREATE POLICY "Users delete own screenshots" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = auth.uid()::text);
