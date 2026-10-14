-- ====================================================================
-- Flappy Bird Multiplayer - Supabase Leaderboard Database Schema
-- ====================================================================
-- Run this script in the Supabase SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> Run
-- ====================================================================

-- 1. Create table `leaderboard`
CREATE TABLE IF NOT EXISTS public.leaderboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Create index for fast leaderboard ordering (highest score first, earliest on tie)
CREATE INDEX IF NOT EXISTS idx_leaderboard_score_created 
ON public.leaderboard (score DESC, created_at ASC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.leaderboard ENABLE ROW LEVEL SECURITY;

-- 4. Policy: Allow public read access to the leaderboard (Top 10 / Rankings)
DROP POLICY IF EXISTS "Allow public read access to leaderboard" ON public.leaderboard;
CREATE POLICY "Allow public read access to leaderboard"
ON public.leaderboard
FOR SELECT
USING (true);

-- 5. Policy: Allow insert access for server / backend
DROP POLICY IF EXISTS "Allow insert access to leaderboard" ON public.leaderboard;
CREATE POLICY "Allow insert access to leaderboard"
ON public.leaderboard
FOR INSERT
WITH CHECK (true);

-- 6. Optional: Insert initial seed Hall-of-Fame records
INSERT INTO public.leaderboard (player_name, score, created_at)
VALUES 
    ('SkyKing', 48, now() - interval '2 days'),
    ('AceFlapper', 36, now() - interval '1 day'),
    ('PixelBird', 27, now() - interval '12 hours'),
    ('WingMaster', 19, now() - interval '3 days'),
    ('FeatherPro', 14, now() - interval '6 hours'),
    ('CloudRider', 10, now() - interval '4 days'),
    ('BreezeFlyer', 6, now() - interval '1 day'),
    ('ChirpChampion', 4, now() - interval '2 days')
ON CONFLICT DO NOTHING;
