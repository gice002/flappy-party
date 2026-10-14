const { createClient } = require("@supabase/supabase-js");

class SupabaseLeaderboardService {
    constructor() {
        this.client = null;
        this.isConfigured = false;
        
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
        const url = (process.env.SUPABASE_URL || "").trim();
        const key = (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

        const isUrlValid = url.startsWith("http://") || url.startsWith("https://");
        const isNotPlaceholder = !url.includes("your-project-id") && !key.includes("your-supabase") && key.length > 10;

        if (isUrlValid && isNotPlaceholder) {
            try {
                this.client = createClient(url, key, {
                    auth: { persistSession: false }
                });
                this.isConfigured = true;
                console.log(`[Supabase] Initialized Supabase client for Leaderboard (URL: ${url})`);
            } catch (err) {
                console.error("[Supabase] Initialization failed:", err.message);
                this.isConfigured = false;
            }
        } else {
            console.log("[Supabase] SUPABASE_URL / SUPABASE_KEY not configured or using placeholders. Using in-memory fallback leaderboard.");
            this.isConfigured = false;
        }
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
        if (!this.isConfigured || !this.client) {
            return this.getFallbackTop(limit);
        }

        try {
            const { data, error } = await this.client
                .from("leaderboard")
                .select("id, player_name, score, created_at")
                .order("score", { ascending: false })
                .order("created_at", { ascending: true })
                .limit(limit);

            if (error) {
                console.error("[Supabase] Error fetching top scores:", error.message);
                return this.getFallbackTop(limit);
            }

            return (data || []).map((row, idx) => this.formatRow(row, idx + 1));
        } catch (err) {
            console.error("[Supabase] Unexpected error fetching leaderboard:", err.message);
            return this.getFallbackTop(limit);
        }
    }

    async recordScore(playerName, score) {
        const cleanName = String(playerName || "FlappyHero").trim().slice(0, 16) || "FlappyHero";
        const validScore = Math.max(0, parseInt(score, 10) || 0);

        if (!this.isConfigured || !this.client) {
            // In-Memory Fallback Recording
            const newEntry = {
                id: "local-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6),
                name: cleanName,
                score: validScore,
                created_at: new Date().toISOString()
            };
            this.fallbackLeaderboard.push(newEntry);
            this.fallbackLeaderboard.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (a.created_at || "").localeCompare(b.created_at || "");
            });

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

        try {
            // Authoritative direct insert into Supabase
            const { data: inserted, error: insertError } = await this.client
                .from("leaderboard")
                .insert([{
                    player_name: cleanName,
                    score: validScore
                }])
                .select();

            if (insertError) {
                console.error("[Supabase] Insert failed:", insertError.message);
                // Graceful fallback on error
                return this.recordScoreFallback(cleanName, validScore);
            }

            const insertedRow = inserted && inserted[0] ? inserted[0] : null;

            // Query player rank: count records with strictly higher score
            let playerRank = 1;
            try {
                const { count, error: countError } = await this.client
                    .from("leaderboard")
                    .select("id", { count: "exact", head: true })
                    .gt("score", validScore);

                if (!countError && typeof count === "number") {
                    playerRank = count + 1;
                }
            } catch (countErr) {
                console.warn("[Supabase] Could not calculate exact rank count:", countErr.message);
            }

            const topScores = await this.getTopScores(10);

            return {
                success: true,
                leaderboard: topScores,
                playerRank: playerRank,
                newEntry: insertedRow ? this.formatRow(insertedRow, playerRank) : { name: cleanName, score: validScore, rank: playerRank },
                source: "supabase"
            };
        } catch (err) {
            console.error("[Supabase] Unexpected error saving score:", err.message);
            return this.recordScoreFallback(cleanName, validScore);
        }
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
