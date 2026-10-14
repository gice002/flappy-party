-- ====================================================================
-- Flappy Bird Multiplayer - 5 Core Database Tables for Supabase
-- Updated with Human-Readable Attributes & Audit Columns
-- 1. Player (player_id, player_name, unlocked_hats, unlocked_hat_names, created_at)
-- 2. Login (login_id, player_id, player_name, username, password, created_at)
-- 3. Leaderboard (leaderboard_id, player_id, player_name, score, rank_tier, created_at)
-- 4. Wallet (wallet_id, player_id, player_name, balance, updated_at)
-- 5. Transaction_Log (log_id, player_id, player_name, amount, transaction_type, reason, created_at)
-- ====================================================================

-- 1. Table: player
CREATE TABLE IF NOT EXISTS public.player (
    player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_name TEXT NOT NULL UNIQUE,
    unlocked_hats INTEGER[] DEFAULT '{0, 3}', -- Free hats: 0 (None), 3 (Red Cap)
    unlocked_hat_names TEXT[] DEFAULT '{"None", "Red Cap"}', -- Human-readable hat names: "None", "Red Cap", "Golden Crown", "Top Hat", "Viking Helmet"
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Table: login
CREATE TABLE IF NOT EXISTS public.login (
    login_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    player_name TEXT, -- Human-readable in-game display name for quick identification
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, -- Plain text as requested in specification
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Table: leaderboard
CREATE TABLE IF NOT EXISTS public.leaderboard (
    leaderboard_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES public.player(player_id) ON DELETE SET NULL,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    rank_tier TEXT DEFAULT '🥉 Bronze Flapper', -- Human-readable tier (Champion, Diamond, Gold, Silver, Bronze)
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure schema updates for existing installations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'player' AND column_name = 'unlocked_hat_names') THEN
        ALTER TABLE public.player ADD COLUMN unlocked_hat_names TEXT[] DEFAULT '{"None", "Red Cap"}';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'login' AND column_name = 'player_name') THEN
        ALTER TABLE public.login ADD COLUMN player_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leaderboard' AND column_name = 'player_id') THEN
        ALTER TABLE public.leaderboard ADD COLUMN player_id UUID REFERENCES public.player(player_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leaderboard' AND column_name = 'leaderboard_id') THEN
        ALTER TABLE public.leaderboard ADD COLUMN leaderboard_id UUID DEFAULT gen_random_uuid();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leaderboard' AND column_name = 'rank_tier') THEN
        ALTER TABLE public.leaderboard ADD COLUMN rank_tier TEXT DEFAULT '🥉 Bronze Flapper';
    END IF;
END $$;

-- 4. Table: wallet
CREATE TABLE IF NOT EXISTS public.wallet (
    wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID UNIQUE NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    player_name TEXT, -- Human-readable player name directly visible on wallet inspection
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Table: transaction_log
CREATE TABLE IF NOT EXISTS public.transaction_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    player_name TEXT, -- Human-readable player name
    amount INTEGER NOT NULL,
    transaction_type TEXT DEFAULT 'REWARD_EARNED', -- Human-readable type: 'REWARD_EARNED', 'ITEM_PURCHASE', 'ACCOUNT_INITIAL'
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure schema updates for existing wallet & transaction_log
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet' AND column_name = 'player_name') THEN
        ALTER TABLE public.wallet ADD COLUMN player_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transaction_log' AND column_name = 'player_name') THEN
        ALTER TABLE public.transaction_log ADD COLUMN player_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transaction_log' AND column_name = 'transaction_type') THEN
        ALTER TABLE public.transaction_log ADD COLUMN transaction_type TEXT DEFAULT 'REWARD_EARNED';
    END IF;
END $$;

-- Create helpful indexes for performance
CREATE INDEX IF NOT EXISTS idx_player_name ON public.player (player_name);
CREATE INDEX IF NOT EXISTS idx_login_username ON public.login (username);
CREATE INDEX IF NOT EXISTS idx_leaderboard_score_created ON public.leaderboard (score DESC, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_player_unique ON public.leaderboard (LOWER(player_name));
CREATE INDEX IF NOT EXISTS idx_wallet_player_id ON public.wallet (player_id);
CREATE INDEX IF NOT EXISTS idx_wallet_player_name ON public.wallet (player_name);
CREATE INDEX IF NOT EXISTS idx_transaction_log_player ON public.transaction_log (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transaction_log_player_name ON public.transaction_log (player_name, created_at DESC);

-- Enable RLS and create public policies
ALTER TABLE public.player ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access to player" ON public.player;
CREATE POLICY "Public access to player" ON public.player FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to login" ON public.login;
CREATE POLICY "Public access to login" ON public.login FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to leaderboard" ON public.leaderboard;
CREATE POLICY "Public access to leaderboard" ON public.leaderboard FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to wallet" ON public.wallet;
CREATE POLICY "Public access to wallet" ON public.wallet FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to transaction_log" ON public.transaction_log;
CREATE POLICY "Public access to transaction_log" ON public.transaction_log FOR ALL USING (true) WITH CHECK (true);
