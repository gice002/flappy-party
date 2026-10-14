-- ====================================================================
-- Flappy Bird Multiplayer - 5 Core Database Tables for Supabase
-- 1. Player
-- 2. Login
-- 3. Leaderboard
-- 4. Wallet
-- 5. Transaction_Log
-- ====================================================================

-- 1. Table: player
CREATE TABLE IF NOT EXISTS public.player (
    player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_name TEXT NOT NULL UNIQUE,
    unlocked_hats INTEGER[] DEFAULT '{0, 3}', -- Free hats: 0 (None), 3 (Red Cap)
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Table: login
CREATE TABLE IF NOT EXISTS public.login (
    login_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, -- Plain text as requested in specification
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Table: leaderboard
-- Check if table exists; create if not, or update schema
CREATE TABLE IF NOT EXISTS public.leaderboard (
    leaderboard_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES public.player(player_id) ON DELETE SET NULL,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure leaderboard_id and player_id exist on leaderboard if table already existed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leaderboard' AND column_name = 'player_id') THEN
        ALTER TABLE public.leaderboard ADD COLUMN player_id UUID REFERENCES public.player(player_id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leaderboard' AND column_name = 'leaderboard_id') THEN
        ALTER TABLE public.leaderboard ADD COLUMN leaderboard_id UUID DEFAULT gen_random_uuid();
    END IF;
END $$;

-- 4. Table: wallet
CREATE TABLE IF NOT EXISTS public.wallet (
    wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID UNIQUE NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Table: transaction_log
CREATE TABLE IF NOT EXISTS public.transaction_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Create helpful indexes for performance
CREATE INDEX IF NOT EXISTS idx_player_name ON public.player (player_name);
CREATE INDEX IF NOT EXISTS idx_login_username ON public.login (username);
CREATE INDEX IF NOT EXISTS idx_leaderboard_score_created ON public.leaderboard (score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_wallet_player_id ON public.wallet (player_id);
CREATE INDEX IF NOT EXISTS idx_transaction_log_player ON public.transaction_log (player_id, created_at DESC);

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
