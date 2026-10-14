const { Pool } = require("pg");
const { createClient } = require("@supabase/supabase-js");

class SupabaseLeaderboardService {
    constructor() {
        this.pgPool = null;
        this.supabaseClient = null;
        this.isConfigured = false;
        this.connectionType = "fallback";

        // Initial in-memory fallback data if Supabase keys are not set yet
        this.fallbackLeaderboard = [
            { id: "mock-1", name: "SkyKing", score: 48, created_at: new Date(Date.now() - 172800000).toISOString() },
            { id: "mock-2", name: "AceFlapper", score: 36, created_at: new Date(Date.now() - 86400000).toISOString() },
            { id: "mock-3", name: "PixelBird", score: 27, created_at: new Date(Date.now() - 43200000).toISOString() },
            { id: "mock-4", name: "WingMaster", score: 19, created_at: new Date(Date.now() - 259200000).toISOString() },
            { id: "mock-5", name: "FeatherPro", score: 14, created_at: new Date(Date.now() - 21600000).toISOString() },
            { id: "mock-6", name: "CloudRider", score: 10, created_at: new Date(Date.now() - 345600000).toISOString() },
            { id: "mock-7", name: "BreezeFlyer", score: 6, created_at: new Date(Date.now() - 86400000).toISOString() },
            { id: "mock-8", name: "ChirpChampion", score: 4, created_at: new Date(Date.now() - 172800000).toISOString() }
        ];

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

    // Helper: Map DB row to standard Leaderboard Entry
    formatRow(row, rank = null) {
        return {
            id: row.id,
            rank: rank,
            name: row.player_name || row.name || "Anonymous",
            score: Number(row.score) || 0,
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
                    `SELECT id, player_name, score, created_at 
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
                    .select("id, player_name, score, created_at")
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

        if (!this.isConfigured) {
            return this.recordScoreFallback(cleanName, validScore);
        }

        // Method 1: Native Postgres Pool
        if (this.pgPool) {
            try {
                const insertRes = await this.pgPool.query(
                    `INSERT INTO public.leaderboard (player_name, score) 
                     VALUES ($1, $2) 
                     RETURNING id, player_name, score, created_at`,
                    [cleanName, validScore]
                );
                const insertedRow = insertRes.rows && insertRes.rows[0] ? insertRes.rows[0] : null;

                // Calculate rank: count rows with strictly higher score
                let playerRank = 1;
                try {
                    const rankRes = await this.pgPool.query(
                        `SELECT count(*)::int AS higher_count 
                         FROM public.leaderboard 
                         WHERE score > $1`,
                        [validScore]
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
                    newEntry: insertedRow ? this.formatRow(insertedRow, playerRank) : { name: cleanName, score: validScore, rank: playerRank },
                    source: "supabase_postgres"
                };
            } catch (err) {
                console.error("[Supabase Postgres] Insert error:", err.message);
                return this.recordScoreFallback(cleanName, validScore);
            }
        }

        // Method 2: Supabase REST Client
        if (this.supabaseClient) {
            try {
                const { data: inserted, error: insertError } = await this.supabaseClient
                    .from("leaderboard")
                    .insert([{
                        player_name: cleanName,
                        score: validScore
                    }])
                    .select();

                if (insertError) {
                    console.error("[Supabase REST] Insert failed:", insertError.message);
                    return this.recordScoreFallback(cleanName, validScore);
                }

                const insertedRow = inserted && inserted[0] ? inserted[0] : null;

                let playerRank = 1;
                try {
                    const { count, error: countError } = await this.supabaseClient
                        .from("leaderboard")
                        .select("id", { count: "exact", head: true })
                        .gt("score", validScore);

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
                    newEntry: insertedRow ? this.formatRow(insertedRow, playerRank) : { name: cleanName, score: validScore, rank: playerRank },
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
        const newEntry = {
            id: "local-" + Date.now(),
            name: cleanName,
            score: validScore,
            created_at: new Date().toISOString()
        };
        this.fallbackLeaderboard.push(newEntry);
        this.fallbackLeaderboard.sort((a, b) => b.score - a.score);
        const playerRank = this.fallbackLeaderboard.findIndex(e => e.id === newEntry.id) + 1;
        const topScores = this.getFallbackTop(10);

        return {
            success: true,
            leaderboard: topScores,
            playerRank: playerRank,
            newEntry: this.formatRow(newEntry, playerRank),
            source: "fallback"
        };
    }
}

// Export singleton instance
const supabaseLeaderboardService = new SupabaseLeaderboardService();
module.exports = supabaseLeaderboardService;
