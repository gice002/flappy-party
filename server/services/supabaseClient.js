const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

class SupabaseLeaderboardService {
    constructor() {
        this.pgPool = null;
        this.supabaseClient = null;
        this.isConfigured = false;
        this.connectionType = "fallback";

        // Initial in-memory fallback data (starts clean, no dummy seed data)
        this.fallbackLeaderboard = [];

        this.init();
    }

    init() {
        const dbUrl = (process.env.DATABASE_URL || process.env.DIRECT_URL || "").trim();
        const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
        const supabaseKey = (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

        // 1. Direct PostgreSQL Connection Pooler (Preferred for transaction pooler / IPv4 pooler)
        if (dbUrl && !dbUrl.includes("[YOUR-PASSWORD]") && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"))) {
            try {
                this.pgPool = new Pool({
                    connectionString: dbUrl,
                    ssl: { rejectUnauthorized: false },
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 6000
                });

                // Error listener on idle pool clients
                this.pgPool.on("error", (err) => {
                    console.error("[Supabase Postgres] Idle client error:", err.message);
                });

                this.isConfigured = true;
                this.connectionType = "postgres_direct";
                console.log("[Supabase] Successfully connected to Supabase Postgres via connection pooler.");
                return;
            } catch (err) {
                console.error("[Supabase] Failed to initialize Postgres pool:", err.message);
            }
        }

        // 2. Supabase REST API Client
        const isUrlValid = supabaseUrl.startsWith("http://") || supabaseUrl.startsWith("https://");
        const isKeyValid = supabaseKey && !supabaseKey.includes("your-supabase") && supabaseKey.length > 10;

        if (isUrlValid && isKeyValid) {
            try {
                this.supabaseClient = createClient(supabaseUrl, supabaseKey, {
                    auth: { persistSession: false }
                });
                this.isConfigured = true;
                this.connectionType = "supabase_rest";
                console.log(`[Supabase] Initialized Supabase REST client for Leaderboard (URL: ${supabaseUrl})`);
                return;
            } catch (err) {
                console.error("[Supabase] Initialization of REST client failed:", err.message);
            }
        }

        console.log("[Supabase] Running with in-memory fallback leaderboard.");
        this.isConfigured = false;
        this.connectionType = "fallback";
    }

    // Helper: Calculate human-readable rank tier
    getRankTier(score) {
        score = Number(score) || 0;
        if (score >= 40) return '👑 Champion';
        if (score >= 25) return '💎 Diamond Flapper';
        if (score >= 15) return '🥇 Gold Flapper';
        if (score >= 8)  return '🥈 Silver Flapper';
        return '🥉 Bronze Flapper';
    }

    // Helper: Map DB row to standard Leaderboard Entry
    formatRow(row, rank = null) {
        const score = Number(row.score) || 0;
        return {
            id: row.id,
            rank: rank,
            name: row.player_name || row.name || "Anonymous",
            score: score,
            rankTier: row.rank_tier || this.getRankTier(score),
            date: row.created_at ? new Date(row.created_at).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
            createdAt: row.created_at || new Date().toISOString()
        };
    }

    getFallbackTop(limit = 10) {
        const sorted = [...this.fallbackLeaderboard].sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return (a.created_at || "").localeCompare(b.created_at || "");
        });
        return sorted.slice(0, limit).map((entry, idx) => this.formatRow(entry, idx + 1));
    }

    async getTopScores(limit = 10) {
        if (!this.isConfigured) {
            return this.getFallbackTop(limit);
        }

        // Method 1: Native Postgres Pool
        if (this.pgPool) {
            try {
                const res = await this.pgPool.query(
                    `SELECT id, player_name, score, rank_tier, created_at 
                     FROM public.leaderboard 
                     ORDER BY score DESC, created_at ASC 
                     LIMIT $1`,
                    [limit]
                );
                return (res.rows || []).map((row, idx) => this.formatRow(row, idx + 1));
            } catch (err) {
                console.error("[Supabase Postgres] Error fetching leaderboard:", err.message);
                return this.getFallbackTop(limit);
            }
        }

        // Method 2: Supabase REST Client
        if (this.supabaseClient) {
            try {
                const { data, error } = await this.supabaseClient
                    .from("leaderboard")
                    .select("id, player_name, score, rank_tier, created_at")
                    .order("score", { ascending: false })
                    .order("created_at", { ascending: true })
                    .limit(limit);

                if (error) {
                    console.error("[Supabase REST] Error fetching leaderboard:", error.message);
                    return this.getFallbackTop(limit);
                }

                return (data || []).map((row, idx) => this.formatRow(row, idx + 1));
            } catch (err) {
                console.error("[Supabase REST] Error fetching leaderboard:", err.message);
                return this.getFallbackTop(limit);
            }
        }

        return this.getFallbackTop(limit);
    }

    async recordScore(playerName, score) {
        const cleanName = String(playerName || "FlappyHero").trim().slice(0, 16) || "FlappyHero";
        const validScore = Math.max(0, parseInt(score, 10) || 0);
        const rankTier = this.getRankTier(validScore);

        if (!this.isConfigured) {
            return this.recordScoreFallback(cleanName, validScore);
        }

        // Method 1: Native Postgres Pool
        if (this.pgPool) {
            try {
                // Atomic Personal Best Upsert with expression unique index
                const upsertRes = await this.pgPool.query(
                    `INSERT INTO public.leaderboard (player_name, score, rank_tier, created_at)
                     VALUES ($1, $2, $3, now())
                     ON CONFLICT (LOWER(player_name))
                     DO UPDATE SET 
                         score = GREATEST(public.leaderboard.score, EXCLUDED.score),
                         rank_tier = CASE WHEN EXCLUDED.score > public.leaderboard.score THEN EXCLUDED.rank_tier ELSE public.leaderboard.rank_tier END,
                         created_at = CASE WHEN EXCLUDED.score > public.leaderboard.score THEN now() ELSE public.leaderboard.created_at END
                     RETURNING id, player_name, score, rank_tier, created_at`,
                    [cleanName, validScore, rankTier]
                );

                const insertedRow = upsertRes.rows && upsertRes.rows[0] ? upsertRes.rows[0] : null;

                // Calculate rank: count rows with strictly higher score
                let playerRank = 1;
                try {
                    const effectiveScore = insertedRow ? insertedRow.score : validScore;
                    const rankRes = await this.pgPool.query(
                        `SELECT count(*)::int AS higher_count 
                         FROM public.leaderboard 
                         WHERE score > $1`,
                        [effectiveScore]
                    );
                    playerRank = (rankRes.rows[0]?.higher_count || 0) + 1;
                } catch (rankErr) {
                    console.warn("[Supabase Postgres] Rank count error:", rankErr.message);
                }

                const topScores = await this.getTopScores(10);
                return {
                    success: true,
                    leaderboard: topScores,
                    playerRank: playerRank,
                    newEntry: insertedRow ? this.formatRow(insertedRow, playerRank) : { name: cleanName, score: validScore, rankTier, rank: playerRank },
                    source: "supabase_postgres"
                };
            } catch (err) {
                console.error("[Supabase Postgres] Insert/Update error:", err.message);
                return this.recordScoreFallback(cleanName, validScore);
            }
        }

        // Method 2: Supabase REST Client
        if (this.supabaseClient) {
            try {
                const { data: existingList } = await this.supabaseClient
                    .from("leaderboard")
                    .select("id, player_name, score, rank_tier")
                    .ilike("player_name", cleanName);

                let insertedRow = null;
                if (existingList && existingList.length > 0) {
                    const existing = existingList[0];
                    if (validScore > existing.score) {
                        const { data: updated } = await this.supabaseClient
                            .from("leaderboard")
                            .update({ score: validScore, rank_tier: rankTier, created_at: new Date().toISOString() })
                            .eq("id", existing.id)
                            .select();
                        insertedRow = updated && updated[0] ? updated[0] : null;
                    } else {
                        insertedRow = existing;
                    }
                } else {
                    const { data: inserted, error: insertError } = await this.supabaseClient
                        .from("leaderboard")
                        .insert([{
                            player_name: cleanName,
                            score: validScore,
                            rank_tier: rankTier
                        }])
                        .select();

                    if (insertError) {
                        console.error("[Supabase REST] Insert failed:", insertError.message);
                        return this.recordScoreFallback(cleanName, validScore);
                    }
                    insertedRow = inserted && inserted[0] ? inserted[0] : null;
                }

                let playerRank = 1;
                try {
                    const effectiveScore = insertedRow ? insertedRow.score : validScore;
                    const { count, error: countError } = await this.supabaseClient
                        .from("leaderboard")
                        .select("id", { count: "exact", head: true })
                        .gt("score", effectiveScore);

                    if (!countError && typeof count === "number") {
                        playerRank = count + 1;
                    }
                } catch (countErr) {
                    console.warn("[Supabase REST] Rank count error:", countErr.message);
                }

                const topScores = await this.getTopScores(10);
                return {
                    success: true,
                    leaderboard: topScores,
                    playerRank: playerRank,
                    newEntry: insertedRow ? this.formatRow(insertedRow, playerRank) : { name: cleanName, score: validScore, rankTier, rank: playerRank },
                    source: "supabase_rest"
                };
            } catch (err) {
                console.error("[Supabase REST] Error saving score:", err.message);
                return this.recordScoreFallback(cleanName, validScore);
            }
        }

        return this.recordScoreFallback(cleanName, validScore);
    }

    recordScoreFallback(cleanName, validScore) {
        const rankTier = this.getRankTier(validScore);
        const existingIdx = this.fallbackLeaderboard.findIndex(e => (e.name || "").toLowerCase() === cleanName.toLowerCase());
        let entry;
        if (existingIdx >= 0) {
            if (validScore > this.fallbackLeaderboard[existingIdx].score) {
                this.fallbackLeaderboard[existingIdx].score = validScore;
                this.fallbackLeaderboard[existingIdx].rank_tier = rankTier;
                this.fallbackLeaderboard[existingIdx].created_at = new Date().toISOString();
            }
            entry = this.fallbackLeaderboard[existingIdx];
        } else {
            entry = {
                id: "local-" + Date.now(),
                name: cleanName,
                score: validScore,
                rank_tier: rankTier,
                created_at: new Date().toISOString()
            };
            this.fallbackLeaderboard.push(entry);
        }

        this.fallbackLeaderboard.sort((a, b) => b.score - a.score);
        const playerRank = this.fallbackLeaderboard.findIndex(e => (e.name || "").toLowerCase() === cleanName.toLowerCase()) + 1;
        const topScores = this.getFallbackTop(10);

        return {
            success: true,
            leaderboard: topScores,
            playerRank: playerRank,
            newEntry: this.formatRow(entry, playerRank),
            source: "fallback"
        };
    }
}

// Export singleton instance
const supabaseLeaderboardService = new SupabaseLeaderboardService();
module.exports = supabaseLeaderboardService;
