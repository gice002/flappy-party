const { Pool } = require("pg");

const HATS_CATALOG = [
    { hat_id: 0, name: "None", price: 0, isFree: true, icon: "" },
    { hat_id: 1, name: "Golden Crown", price: 100, isFree: false, icon: "assets/images/hats/hat_crown.png" },
    { hat_id: 2, name: "Top Hat", price: 50, isFree: false, icon: "assets/images/hats/hat_top.png" },
    { hat_id: 3, name: "Red Cap", price: 0, isFree: true, icon: "assets/images/hats/hat_cap.png" },
    { hat_id: 4, name: "Viking Helmet", price: 75, isFree: false, icon: "assets/images/hats/hat_viking.png" }
];

class EconomyService {
    constructor() {
        this.pgPool = null;
        this.isConfigured = false;

        // In-memory fallback stores for offline/local testing
        this.fallbackPlayers = new Map(); // playerName -> { player_id, player_name, unlocked_hats }
        this.fallbackWallets = new Map(); // player_id -> { wallet_id, player_id, balance }
        this.fallbackLogs = []; // array of { log_id, player_id, amount, reason, created_at }

        this.init();
    }

    init() {
        const dbUrl = (process.env.DATABASE_URL || process.env.DIRECT_URL || "").trim();

        if (dbUrl && !dbUrl.includes("[YOUR-PASSWORD]") && (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://"))) {
            try {
                this.pgPool = new Pool({
                    connectionString: dbUrl,
                    ssl: { rejectUnauthorized: false },
                    max: 10,
                    idleTimeoutMillis: 30000,
                    connectionTimeoutMillis: 6000
                });

                this.pgPool.on("error", (err) => {
                    console.error("[Economy Service] Pool error:", err.message);
                });

                this.isConfigured = true;
                console.log("[Economy Service] Connected to Supabase Postgres.");
            } catch (err) {
                console.error("[Economy Service] Initialization failed:", err.message);
                this.isConfigured = false;
            }
        } else {
            this.isConfigured = false;
        }
    }

    getHatsCatalog() {
        return HATS_CATALOG;
    }

    // Helper: Find or create player and wallet
    async getOrCreatePlayer(playerName) {
        const cleanName = String(playerName || "FlappyHero").trim().slice(0, 16) || "FlappyHero";

        if (!this.isConfigured || !this.pgPool) {
            // In-Memory Fallback
            let player = this.fallbackPlayers.get(cleanName);
            if (!player) {
                player = {
                    player_id: "local_p_" + Math.random().toString(36).substring(2, 9),
                    player_name: cleanName,
                    unlocked_hats: [0, 3],
                    created_at: new Date().toISOString()
                };
                this.fallbackPlayers.set(cleanName, player);
                this.fallbackWallets.set(player.player_id, {
                    wallet_id: "local_w_" + Math.random().toString(36).substring(2, 9),
                    player_id: player.player_id,
                    balance: 0,
                    updated_at: new Date().toISOString()
                });
            }
            const wallet = this.fallbackWallets.get(player.player_id) || { balance: 0 };
            return {
                player_id: player.player_id,
                player_name: player.player_name,
                balance: wallet.balance,
                unlocked_hats: player.unlocked_hats || [0, 3]
            };
        }

        try {
            // 1. Query existing player
            let res = await this.pgPool.query(
                `SELECT p.player_id, p.player_name, p.unlocked_hats, COALESCE(w.balance, 0) AS balance
                 FROM public.player p
                 LEFT JOIN public.wallet w ON p.player_id = w.player_id
                 WHERE LOWER(p.player_name) = LOWER($1)`,
                [cleanName]
            );

            if (res.rows.length > 0) {
                const row = res.rows[0];
                return {
                    player_id: row.player_id,
                    player_name: row.player_name,
                    balance: parseInt(row.balance, 10) || 0,
                    unlocked_hats: Array.isArray(row.unlocked_hats) ? row.unlocked_hats : [0, 3]
                };
            }

            // 2. Create new player and wallet atomically
            const insertPlayer = await this.pgPool.query(
                `INSERT INTO public.player (player_name, unlocked_hats)
                 VALUES ($1, '{0, 3}')
                 RETURNING player_id, player_name, unlocked_hats`,
                [cleanName]
            );
            const newPlayer = insertPlayer.rows[0];

            await this.pgPool.query(
                `INSERT INTO public.wallet (player_id, balance)
                 VALUES ($1, 0)
                 ON CONFLICT (player_id) DO NOTHING`,
                [newPlayer.player_id]
            );

            await this.pgPool.query(
                `INSERT INTO public.transaction_log (player_id, amount, reason)
                 VALUES ($1, 0, 'Account Created')`,
                [newPlayer.player_id]
            );

            return {
                player_id: newPlayer.player_id,
                player_name: newPlayer.player_name,
                balance: 0,
                unlocked_hats: newPlayer.unlocked_hats || [0, 3]
            };
        } catch (err) {
            console.error("[Economy Service] getOrCreatePlayer error:", err.message);
            return {
                player_id: "fallback_p",
                player_name: cleanName,
                balance: 0,
                unlocked_hats: [0, 3]
            };
        }
    }

    // Helper: Add or deduct coins from wallet & log transaction
    async updateWallet(playerId, amount, reason) {
        amount = parseInt(amount, 10) || 0;
        if (!playerId) return 0;

        if (!this.isConfigured || !this.pgPool) {
            let wallet = this.fallbackWallets.get(playerId);
            if (!wallet) {
                wallet = { wallet_id: "w_" + Date.now(), player_id: playerId, balance: 0 };
                this.fallbackWallets.set(playerId, wallet);
            }
            wallet.balance = Math.max(0, wallet.balance + amount);
            this.fallbackLogs.push({
                log_id: "log_" + Date.now(),
                player_id: playerId,
                amount,
                reason,
                created_at: new Date().toISOString()
            });
            return wallet.balance;
        }

        try {
            // Atomic update of wallet balance
            const res = await this.pgPool.query(
                `UPDATE public.wallet
                 SET balance = GREATEST(0, balance + $1), updated_at = now()
                 WHERE player_id = $2
                 RETURNING balance`,
                [amount, playerId]
            );

            const newBalance = res.rows.length > 0 ? res.rows[0].balance : 0;

            // Record transaction log
            await this.pgPool.query(
                `INSERT INTO public.transaction_log (player_id, amount, reason)
                 VALUES ($1, $2, $3)`,
                [playerId, amount, reason]
            );

            return newBalance;
        } catch (err) {
            console.error("[Economy Service] updateWallet error:", err.message);
            return 0;
        }
    }

    // ============================================================
    // REWARD FORMULAS (AUTHORITATIVE BACKEND)
    // ============================================================

    // 1. Solo Rank Mode Reward Formula:
    // Score * 2 coins + Milestones (Score >= 10: +5 Coins, Score >= 20: +10 Coins)
    async rewardRankMode(playerName, score) {
        score = Math.max(0, parseInt(score, 10) || 0);
        if (score <= 0) {
            const player = await this.getOrCreatePlayer(playerName);
            return { coinsEarned: 0, newBalance: player.balance, playerName: player.player_name };
        }

        let coins = score * 2;
        if (score >= 20) {
            coins += 10; // Veteran flapper milestone bonus
        } else if (score >= 10) {
            coins += 5; // Apprentice flapper milestone bonus
        }

        const player = await this.getOrCreatePlayer(playerName);
        const reason = `Rank Mode: Passed ${score} pipes (+${coins} Coins)`;
        const newBalance = await this.updateWallet(player.player_id, coins, reason);

        return {
            coinsEarned: coins,
            newBalance,
            playerName: player.player_name,
            reason
        };
    }

    // 2. Multiplayer Race Placement Reward Formula:
    // 1st: 50 Coins, 2nd: 30 Coins, 3rd: 15 Coins, 4th+: 10 Coins, Participation: +5 Coins
    async rewardMultiplayerPlacement(playersRanking) {
        // playersRanking: Array of { playerId, name, ranking, finished }
        const rewardSummary = [];

        const REWARDS_BY_RANK = {
            1: 50,
            2: 30,
            3: 15,
            4: 10
        };

        for (const p of playersRanking) {
            const rank = parseInt(p.ranking, 10) || 0;
            let coins = REWARDS_BY_RANK[rank] || 5;
            if (p.finished && rank > 4) {
                coins += 5; // Finish bonus
            }

            const player = await this.getOrCreatePlayer(p.name);
            const medal = rank === 1 ? "🥇 1st" : rank === 2 ? "🥈 2nd" : rank === 3 ? "🥉 3rd" : `#${rank}`;
            const reason = `Multiplayer Race: ${medal} Place Win (+${coins} Coins)`;
            const newBalance = await this.updateWallet(player.player_id, coins, reason);

            rewardSummary.push({
                socketId: p.playerId,
                playerName: player.player_name,
                ranking: rank,
                coinsEarned: coins,
                newBalance
            });
        }

        return rewardSummary;
    }

    // 3. Chained Mode Team Reward Formula:
    // Completion of match grants 40 Coins to each teammate
    async rewardChainedMode(playerList, teamTime) {
        const rewardSummary = [];
        const coins = 40;

        for (const p of playerList) {
            const player = await this.getOrCreatePlayer(p.name);
            const reason = `Flappy Chained: Team Race Completed in ${teamTime || 'Match'} (+${coins} Coins)`;
            const newBalance = await this.updateWallet(player.player_id, coins, reason);

            rewardSummary.push({
                socketId: p.player_id || p.socketId,
                playerName: player.player_name,
                coinsEarned: coins,
                newBalance
            });
        }

        return rewardSummary;
    }

    // 4. Boss Mode Reward Formula:
    // Full Clear (3 Bosses): 75 Coins, Defeat after Boss 1: 25 Coins, Defeat after Boss 2: 45 Coins
    async rewardBossMode(playerList, clearedBossCount, victory) {
        const rewardSummary = [];
        let coins = 10;
        if (victory) {
            coins = 75;
        } else if (clearedBossCount === 2) {
            coins = 45;
        } else if (clearedBossCount === 1) {
            coins = 25;
        }

        for (const p of playerList) {
            const player = await this.getOrCreatePlayer(p.name);
            const statusText = victory ? "All 3 Bosses Cleared! (Victory)" : `Cleared ${clearedBossCount}/3 Bosses`;
            const reason = `Boss Raid: ${statusText} (+${coins} Coins)`;
            const newBalance = await this.updateWallet(player.player_id, coins, reason);

            rewardSummary.push({
                socketId: p.player_id || p.socketId,
                playerName: player.player_name,
                coinsEarned: coins,
                newBalance
            });
        }

        return rewardSummary;
    }

    // ============================================================
    // HAT SHOP & PURCHASING SYSTEM
    // ============================================================

    async buyHat(playerName, hatId) {
        hatId = parseInt(hatId, 10);
        const hat = HATS_CATALOG.find(h => h.hat_id === hatId);
        if (!hat) {
            return { success: false, error: "Hat not found in catalog" };
        }

        const player = await this.getOrCreatePlayer(playerName);
        const currentHats = player.unlocked_hats || [0, 3];

        // 1. Check if already unlocked
        if (currentHats.includes(hatId)) {
            return {
                success: true,
                message: "Hat is already unlocked!",
                hatId,
                balance: player.balance,
                unlockedHats: currentHats
            };
        }

        // 2. If hat is Free, unlock directly
        if (hat.isFree || hat.price === 0) {
            const updatedHats = [...new Set([...currentHats, hatId])];
            await this.persistUnlockedHats(player.player_id, updatedHats);
            return {
                success: true,
                message: `Unlocked free hat: ${hat.name}!`,
                hatId,
                balance: player.balance,
                unlockedHats: updatedHats
            };
        }

        // 3. Premium Hat: Check Wallet Balance
        if (player.balance < hat.price) {
            return {
                success: false,
                error: `Not enough coins! You need ${hat.price} coins, but only have ${player.balance}.`,
                balance: player.balance,
                required: hat.price
            };
        }

        // 4. Deduct coins & record transaction
        const reason = `Purchased Hat: ${hat.name} (-${hat.price} Coins)`;
        const newBalance = await this.updateWallet(player.player_id, -hat.price, reason);
        const updatedHats = [...new Set([...currentHats, hatId])];
        await this.persistUnlockedHats(player.player_id, updatedHats);

        return {
            success: true,
            message: `Successfully purchased ${hat.name}!`,
            hatId,
            balance: newBalance,
            unlockedHats: updatedHats
        };
    }

    async persistUnlockedHats(playerId, unlockedHats) {
        if (!this.isConfigured || !this.pgPool) {
            for (const p of this.fallbackPlayers.values()) {
                if (p.player_id === playerId) {
                    p.unlocked_hats = unlockedHats;
                    break;
                }
            }
            return;
        }

        try {
            await this.pgPool.query(
                `UPDATE public.player
                 SET unlocked_hats = $1
                 WHERE player_id = $2`,
                [unlockedHats, playerId]
            );
        } catch (err) {
            console.error("[Economy Service] persistUnlockedHats error:", err.message);
        }
    }

    async getTransactionLogs(playerName, limit = 10) {
        const player = await this.getOrCreatePlayer(playerName);

        if (!this.isConfigured || !this.pgPool) {
            const logs = this.fallbackLogs
                .filter(l => l.player_id === player.player_id)
                .slice(-limit)
                .reverse();
            return logs;
        }

        try {
            const res = await this.pgPool.query(
                `SELECT log_id, amount, reason, created_at
                 FROM public.transaction_log
                 WHERE player_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [player.player_id, limit]
            );
            return res.rows;
        } catch (err) {
            console.error("[Economy Service] getTransactionLogs error:", err.message);
            return [];
        }
    }
}

const economyService = new EconomyService();
module.exports = economyService;
