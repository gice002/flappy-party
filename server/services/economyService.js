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
        this.fallbackLogins = new Map();  // username.toLowerCase() -> { login_id, player_id, username, password }
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

    mapHatsToNames(unlockedHats) {
        if (!Array.isArray(unlockedHats)) return ["None", "Red Cap"];
        return unlockedHats.map(id => {
            const hat = HATS_CATALOG.find(h => h.hat_id === Number(id));
            return hat ? hat.name : `Hat #${id}`;
        });
    }

    // ====================================================================
    // USER AUTHENTICATION: SIGN UP, SIGN IN, PROFILE SESSION
    // ====================================================================

    /**
     * Sign Up a new player account:
     * - Validates username uniqueness in Login table
     * - Creates row in Player table (returns player_id) with human-readable unlocked_hat_names
     * - Creates row in Login table (player_id, player_name, username, password)
     * - Creates row in Wallet table (player_id, player_name, balance = 0)
     * - Creates row in Transaction_Log table (player_id, player_name, amount, transaction_type, reason)
     */
    async signUp(username, password, playerName = "") {
        const cleanUsername = String(username || "").trim();
        const cleanPassword = String(password || "").trim();

        if (!cleanUsername || cleanUsername.length < 3) {
            throw new Error("Username must be at least 3 characters long");
        }
        if (!cleanPassword) {
            throw new Error("Password is required");
        }

        const rawPlayerName = String(playerName || cleanUsername).trim().slice(0, 16) || "Hero";

        // Fallback In-Memory Mode
        if (!this.isConfigured || !this.pgPool) {
            const lowerUser = cleanUsername.toLowerCase();
            if (this.fallbackLogins.has(lowerUser)) {
                throw new Error("Username already taken! Please choose another.");
            }

            const playerId = "local_p_" + Math.random().toString(36).substring(2, 9);
            const loginId = "local_l_" + Math.random().toString(36).substring(2, 9);
            const walletId = "local_w_" + Math.random().toString(36).substring(2, 9);

            const playerObj = {
                player_id: playerId,
                player_name: rawPlayerName,
                unlocked_hats: [0, 3],
                unlocked_hat_names: ["None", "Red Cap"],
                created_at: new Date().toISOString()
            };
            this.fallbackPlayers.set(rawPlayerName.toLowerCase(), playerObj);
            this.fallbackLogins.set(lowerUser, {
                login_id: loginId,
                player_id: playerId,
                player_name: rawPlayerName,
                username: cleanUsername,
                password: cleanPassword,
                created_at: new Date().toISOString()
            });
            this.fallbackWallets.set(playerId, {
                wallet_id: walletId,
                player_id: playerId,
                player_name: rawPlayerName,
                balance: 0,
                updated_at: new Date().toISOString()
            });
            this.fallbackLogs.push({
                log_id: "log_" + Date.now(),
                player_id: playerId,
                player_name: rawPlayerName,
                amount: 0,
                transaction_type: "ACCOUNT_INITIAL",
                reason: "Account Created",
                created_at: new Date().toISOString()
            });

            return {
                success: true,
                player_id: playerId,
                player_name: rawPlayerName,
                username: cleanUsername,
                balance: 0,
                unlocked_hats: [0, 3],
                unlocked_hat_names: ["None", "Red Cap"]
            };
        }

        // Supabase / PostgreSQL Mode
        try {
            // 1. Verify username uniqueness in `login`
            const userCheck = await this.pgPool.query(
                `SELECT login_id FROM public.login WHERE LOWER(username) = LOWER($1)`,
                [cleanUsername]
            );
            if (userCheck.rows.length > 0) {
                throw new Error("Username already taken! Please choose another.");
            }

            // 2. Resolve unique player_name in `player`
            let effectivePlayerName = rawPlayerName;
            const nameCheck = await this.pgPool.query(
                `SELECT player_id FROM public.player WHERE LOWER(player_name) = LOWER($1)`,
                [effectivePlayerName]
            );
            if (nameCheck.rows.length > 0) {
                effectivePlayerName = `${effectivePlayerName.slice(0, 11)}_${Math.floor(100 + Math.random() * 899)}`;
            }

            // 3. Insert into Player table with human-readable unlocked_hat_names
            const insertPlayer = await this.pgPool.query(
                `INSERT INTO public.player (player_name, unlocked_hats, unlocked_hat_names)
                 VALUES ($1, '{0, 3}', '{"None", "Red Cap"}')
                 RETURNING player_id, player_name, unlocked_hats, unlocked_hat_names`,
                [effectivePlayerName]
            );
            const newPlayer = insertPlayer.rows[0];

            // 4. Insert into Login table (including human-readable player_name)
            await this.pgPool.query(
                `INSERT INTO public.login (player_id, player_name, username, password)
                 VALUES ($1, $2, $3, $4)`,
                [newPlayer.player_id, newPlayer.player_name, cleanUsername, cleanPassword]
            );

            // 5. Insert into Wallet table (including human-readable player_name, balance = 0)
            await this.pgPool.query(
                `INSERT INTO public.wallet (player_id, player_name, balance)
                 VALUES ($1, $2, 0)
                 ON CONFLICT (player_id) DO UPDATE SET player_name = EXCLUDED.player_name`,
                [newPlayer.player_id, newPlayer.player_name]
            );

            // 6. Log transaction for initial account creation (with player_name and transaction_type)
            await this.pgPool.query(
                `INSERT INTO public.transaction_log (player_id, player_name, amount, transaction_type, reason)
                 VALUES ($1, $2, 0, 'ACCOUNT_INITIAL', 'Account Created')`,
                [newPlayer.player_id, newPlayer.player_name]
            );

            return {
                success: true,
                player_id: newPlayer.player_id,
                player_name: newPlayer.player_name,
                username: cleanUsername,
                balance: 0,
                unlocked_hats: Array.isArray(newPlayer.unlocked_hats) ? newPlayer.unlocked_hats : [0, 3],
                unlocked_hat_names: Array.isArray(newPlayer.unlocked_hat_names) ? newPlayer.unlocked_hat_names : ["None", "Red Cap"]
            };
        } catch (err) {
            console.error("[Economy Service] signUp error:", err.message);
            throw err;
        }
    }

    /**
     * Sign In an existing player account:
     * - Checks username and plain-text password with Login table
     * - Returns player_id, player_name, username, balance, unlocked_hats
     */
    async signIn(username, password) {
        const cleanUsername = String(username || "").trim();
        const cleanPassword = String(password || "").trim();

        if (!cleanUsername || !cleanPassword) {
            throw new Error("Please enter both username and password");
        }

        // Fallback In-Memory Mode
        if (!this.isConfigured || !this.pgPool) {
            const lowerUser = cleanUsername.toLowerCase();
            const login = this.fallbackLogins.get(lowerUser);
            if (!login) {
                throw new Error("Invalid username or password");
            }
            if (login.password !== cleanPassword) {
                throw new Error("Invalid username or password");
            }
            let player = null;
            for (let p of this.fallbackPlayers.values()) {
                if (p.player_id === login.player_id) {
                    player = p;
                    break;
                }
            }
            const wallet = this.fallbackWallets.get(login.player_id) || { balance: 0 };
            const fallbackHatNames = player && player.unlocked_hat_names ? player.unlocked_hat_names : this.mapHatsToNames(player ? player.unlocked_hats : [0, 3]);
            return {
                success: true,
                player_id: login.player_id,
                player_name: player ? player.player_name : login.username,
                username: login.username,
                balance: wallet.balance,
                unlocked_hats: player && player.unlocked_hats ? player.unlocked_hats : [0, 3],
                unlocked_hat_names: fallbackHatNames
            };
        }

        // Supabase / PostgreSQL Mode
        try {
            const res = await this.pgPool.query(
                `SELECT l.login_id, l.player_id, l.username, l.password,
                        p.player_name, p.unlocked_hats, p.unlocked_hat_names, COALESCE(w.balance, 0) AS balance
                 FROM public.login l
                 JOIN public.player p ON l.player_id = p.player_id
                 LEFT JOIN public.wallet w ON p.player_id = w.player_id
                 WHERE LOWER(l.username) = LOWER($1)`,
                [cleanUsername]
            );

            if (res.rows.length === 0) {
                throw new Error("Invalid username or password");
            }

            const row = res.rows[0];
            if (row.password !== cleanPassword) {
                throw new Error("Invalid username or password");
            }

            const hatIds = Array.isArray(row.unlocked_hats) ? row.unlocked_hats : [0, 3];
            const hatNames = Array.isArray(row.unlocked_hat_names) ? row.unlocked_hat_names : this.mapHatsToNames(hatIds);

            return {
                success: true,
                player_id: row.player_id,
                player_name: row.player_name,
                username: row.username,
                balance: parseInt(row.balance, 10) || 0,
                unlocked_hats: hatIds,
                unlocked_hat_names: hatNames
            };
        } catch (err) {
            console.error("[Economy Service] signIn error:", err.message);
            throw err;
        }
    }

    /**
     * Get player auth profile by player_id or username
     */
    async getAuthProfile(playerId, username) {
        if (!playerId && !username) return null;

        if (!this.isConfigured || !this.pgPool) {
            if (username) {
                const login = this.fallbackLogins.get(String(username).toLowerCase());
                if (login) {
                    const wallet = this.fallbackWallets.get(login.player_id) || { balance: 0 };
                    let player = null;
                    for (let p of this.fallbackPlayers.values()) {
                        if (p.player_id === login.player_id) {
                            player = p;
                            break;
                        }
                    }
                    const fallbackHatNames = player && player.unlocked_hat_names ? player.unlocked_hat_names : this.mapHatsToNames(player ? player.unlocked_hats : [0, 3]);
                    return {
                        player_id: login.player_id,
                        player_name: player ? player.player_name : login.username,
                        username: login.username,
                        balance: wallet.balance,
                        unlocked_hats: player && player.unlocked_hats ? player.unlocked_hats : [0, 3],
                        unlocked_hat_names: fallbackHatNames
                    };
                }
            }
            return null;
        }

        try {
            let query = `
                SELECT l.login_id, l.player_id, l.username,
                       p.player_name, p.unlocked_hats, p.unlocked_hat_names, COALESCE(w.balance, 0) AS balance
                FROM public.login l
                JOIN public.player p ON l.player_id = p.player_id
                LEFT JOIN public.wallet w ON p.player_id = w.player_id
            `;
            const params = [];
            if (playerId) {
                query += ` WHERE l.player_id = $1`;
                params.push(playerId);
            } else {
                query += ` WHERE LOWER(l.username) = LOWER($1)`;
                params.push(String(username).toLowerCase());
            }

            const res = await this.pgPool.query(query, params);
            if (res.rows.length === 0) return null;

            const row = res.rows[0];
            const hatIds = Array.isArray(row.unlocked_hats) ? row.unlocked_hats : [0, 3];
            const hatNames = Array.isArray(row.unlocked_hat_names) ? row.unlocked_hat_names : this.mapHatsToNames(hatIds);

            return {
                player_id: row.player_id,
                player_name: row.player_name,
                username: row.username,
                balance: parseInt(row.balance, 10) || 0,
                unlocked_hats: hatIds,
                unlocked_hat_names: hatNames
            };
        } catch (err) {
            console.error("[Economy Service] getAuthProfile error:", err.message);
            return null;
        }
    }

    // Helper: Find or create player and wallet (Guest / Fallback)
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
                    unlocked_hat_names: ["None", "Red Cap"],
                    created_at: new Date().toISOString()
                };
                this.fallbackPlayers.set(cleanName, player);
                this.fallbackWallets.set(player.player_id, {
                    wallet_id: "local_w_" + Math.random().toString(36).substring(2, 9),
                    player_id: player.player_id,
                    player_name: cleanName,
                    balance: 0,
                    updated_at: new Date().toISOString()
                });
            }
            const wallet = this.fallbackWallets.get(player.player_id) || { balance: 0 };
            return {
                player_id: player.player_id,
                player_name: player.player_name,
                balance: wallet.balance,
                unlocked_hats: player.unlocked_hats || [0, 3],
                unlocked_hat_names: player.unlocked_hat_names || ["None", "Red Cap"]
            };
        }

        try {
            // 1. Query existing player
            let res = await this.pgPool.query(
                `SELECT p.player_id, p.player_name, p.unlocked_hats, p.unlocked_hat_names, COALESCE(w.balance, 0) AS balance
                 FROM public.player p
                 LEFT JOIN public.wallet w ON p.player_id = w.player_id
                 WHERE LOWER(p.player_name) = LOWER($1)`,
                [cleanName]
            );

            if (res.rows.length > 0) {
                const row = res.rows[0];
                const hatIds = Array.isArray(row.unlocked_hats) ? row.unlocked_hats : [0, 3];
                const hatNames = Array.isArray(row.unlocked_hat_names) ? row.unlocked_hat_names : this.mapHatsToNames(hatIds);
                return {
                    player_id: row.player_id,
                    player_name: row.player_name,
                    balance: parseInt(row.balance, 10) || 0,
                    unlocked_hats: hatIds,
                    unlocked_hat_names: hatNames
                };
            }

            // 2. Create new player and wallet atomically with human-readable attributes
            const insertPlayer = await this.pgPool.query(
                `INSERT INTO public.player (player_name, unlocked_hats, unlocked_hat_names)
                 VALUES ($1, '{0, 3}', '{"None", "Red Cap"}')
                 RETURNING player_id, player_name, unlocked_hats, unlocked_hat_names`,
                [cleanName]
            );
            const newPlayer = insertPlayer.rows[0];

            await this.pgPool.query(
                `INSERT INTO public.wallet (player_id, player_name, balance)
                 VALUES ($1, $2, 0)
                 ON CONFLICT (player_id) DO UPDATE SET player_name = EXCLUDED.player_name`,
                [newPlayer.player_id, newPlayer.player_name]
            );

            await this.pgPool.query(
                `INSERT INTO public.transaction_log (player_id, player_name, amount, transaction_type, reason)
                 VALUES ($1, $2, 0, 'ACCOUNT_INITIAL', 'Account Created')`,
                [newPlayer.player_id, newPlayer.player_name]
            );

            return {
                player_id: newPlayer.player_id,
                player_name: newPlayer.player_name,
                balance: 0,
                unlocked_hats: newPlayer.unlocked_hats || [0, 3],
                unlocked_hat_names: newPlayer.unlocked_hat_names || ["None", "Red Cap"]
            };
        } catch (err) {
            console.error("[Economy Service] getOrCreatePlayer error:", err.message);
            return {
                player_id: "fallback_p",
                player_name: cleanName,
                balance: 0,
                unlocked_hats: [0, 3],
                unlocked_hat_names: ["None", "Red Cap"]
            };
        }
    }

    // Helper: Add or deduct coins from wallet & log transaction
    async updateWallet(playerId, amount, reason, playerName = null) {
        amount = parseInt(amount, 10) || 0;
        if (!playerId) return 0;

        const txType = amount > 0 ? "REWARD_EARNED" : (amount < 0 ? "ITEM_PURCHASE" : "ACCOUNT_INITIAL");

        if (!this.isConfigured || !this.pgPool) {
            let wallet = this.fallbackWallets.get(playerId);
            if (!wallet) {
                wallet = { wallet_id: "w_" + Date.now(), player_id: playerId, player_name: playerName || "Player", balance: 0 };
                this.fallbackWallets.set(playerId, wallet);
            }
            wallet.balance = Math.max(0, wallet.balance + amount);
            if (playerName) wallet.player_name = playerName;

            this.fallbackLogs.push({
                log_id: "log_" + Date.now(),
                player_id: playerId,
                player_name: wallet.player_name,
                amount,
                transaction_type: txType,
                reason,
                created_at: new Date().toISOString()
            });
            return wallet.balance;
        }

        try {
            // Atomic update of wallet balance & player_name
            const res = await this.pgPool.query(
                `UPDATE public.wallet
                 SET balance = GREATEST(0, balance + $1),
                     updated_at = now(),
                     player_name = COALESCE($3, player_name, (SELECT player_name FROM public.player WHERE player_id = $2))
                 WHERE player_id = $2
                 RETURNING balance, player_name`,
                [amount, playerId, playerName]
            );

            const newBalance = res.rows.length > 0 ? res.rows[0].balance : 0;
            const effectivePlayerName = (res.rows.length > 0 && res.rows[0].player_name) || playerName;

            // Record transaction log with player_name and transaction_type
            await this.pgPool.query(
                `INSERT INTO public.transaction_log (player_id, player_name, amount, transaction_type, reason)
                 VALUES ($1, $2, $3, $4, $5)`,
                [playerId, effectivePlayerName, amount, txType, reason]
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
        const newBalance = await this.updateWallet(player.player_id, coins, reason, player.player_name);

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
            const newBalance = await this.updateWallet(player.player_id, coins, reason, player.player_name);

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
            const newBalance = await this.updateWallet(player.player_id, coins, reason, player.player_name);

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
            const newBalance = await this.updateWallet(player.player_id, coins, reason, player.player_name);

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
        const newBalance = await this.updateWallet(player.player_id, -hat.price, reason, player.player_name);
        const updatedHats = [...new Set([...currentHats, hatId])];
        await this.persistUnlockedHats(player.player_id, updatedHats);

        return {
            success: true,
            message: `Successfully purchased ${hat.name}!`,
            hatId,
            balance: newBalance,
            unlockedHats: updatedHats,
            unlockedHatNames: this.mapHatsToNames(updatedHats)
        };
    }

    async persistUnlockedHats(playerId, unlockedHats) {
        const hatNames = this.mapHatsToNames(unlockedHats);

        if (!this.isConfigured || !this.pgPool) {
            for (const p of this.fallbackPlayers.values()) {
                if (p.player_id === playerId) {
                    p.unlocked_hats = unlockedHats;
                    p.unlocked_hat_names = hatNames;
                    break;
                }
            }
            return;
        }

        try {
            await this.pgPool.query(
                `UPDATE public.player
                 SET unlocked_hats = $1, unlocked_hat_names = $2
                 WHERE player_id = $3`,
                [unlockedHats, hatNames, playerId]
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
                `SELECT log_id, player_name, amount, transaction_type, reason, created_at
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
