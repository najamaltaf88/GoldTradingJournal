-- XAUUSD Journal — run in Supabase SQL Editor

-- Accounts table (composite PK: logical account id is per-user, e.g. "main")
-- Migration from id-only PK: ALTER TABLE accounts DROP CONSTRAINT accounts_pkey;
--   ALTER TABLE accounts ADD PRIMARY KEY (user_id, id);
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
