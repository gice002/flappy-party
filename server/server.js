const path = require("path");
require("dotenv").config({
    path: [
        path.resolve(__dirname, "../.env"),
        path.resolve(process.cwd(), ".env")
    ]
});
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const LobbyManager = require("./game/lobbyManager");
const rankManager = require("./game/rankManager");
const supabaseLeaderboard = require("./services/supabaseClient");
const economyService = require("./services/economyService");
const initSocketHandler = require("./sockets/socketHandler");

const app = express();

// Trust reverse proxy for PaaS cloud deployments
app.set("trust proxy", 1);

const server = http.createServer(app);

// Native WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

// Map to store connected clients: player_id -> WebSocket instance
const clients = new Map();

const PORT = parseInt(process.env.PORT, 10) || 3000;

// Enable Cross-Origin Resource Sharing (CORS) for external frontends (Vercel, CDN)
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

// Parse JSON request bodies
app.use(express.json());

// Serve client static files
app.use(express.static(path.join(__dirname, "../client")));

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        supabase: supabaseLeaderboard.isConfigured ? "connected" : "fallback_mode",
        timestamp: new Date().toISOString()
    });
});

// ====================================================================
// REST API ENDPOINTS FOR SUPABASE LEADERBOARD & RANK MODE
// ====================================================================

// GET /api/leaderboard - Fetch Top 10 rankings from Supabase
app.get("/api/leaderboard", async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const leaderboard = await rankManager.getLeaderboard(limit);
        res.status(200).json({
            success: true,
            leaderboard,
            isSupabaseConnected: supabaseLeaderboard.isConfigured
        });
    } catch (err) {
        console.error("[API] Error fetching leaderboard:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/rank/start - Start an authoritative solo rank session
app.post("/api/rank/start", (req, res) => {
    try {
        const { playerName } = req.body || {};
        const session = rankManager.startSession(null, playerName);
        res.status(200).json({ success: true, session });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/rank/game-over - Authoritative submission on game over (Server -> Supabase)
app.post("/api/rank/game-over", async (req, res) => {
    try {
        const { sessionId, score, playerName } = req.body || {};
        const result = await rankManager.handleGameOver(null, { sessionId, score, playerName });
        res.status(200).json(result);
    } catch (err) {
        console.error("[API] Error recording rank game over:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ====================================================================
// REST API ENDPOINTS FOR WALLET, SHOP & TRANSACTION LOGS
// ====================================================================

// GET /api/shop/hats - Get list of hats with pricing and unlock requirements
app.get("/api/shop/hats", (req, res) => {
    res.status(200).json({
        success: true,
        hats: economyService.getHatsCatalog()
    });
});

// GET /api/player/profile or /api/player/wallet - Get player wallet balance & unlocked hats
app.get("/api/player/wallet", async (req, res) => {
    try {
        const playerName = req.query.name || "FlappyHero";
        const player = await economyService.getOrCreatePlayer(playerName);
        res.status(200).json({
            success: true,
            player_id: player.player_id,
            player_name: player.player_name,
            balance: player.balance,
            unlocked_hats: player.unlocked_hats
        });
    } catch (err) {
        console.error("[API] Error fetching player wallet:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/shop/buy-hat - Purchase / unlock a hat with wallet balance
app.post("/api/shop/buy-hat", async (req, res) => {
    try {
        const { playerName, hatId } = req.body || {};
        const result = await economyService.buyHat(playerName, hatId);
        res.status(200).json(result);
    } catch (err) {
        console.error("[API] Error purchasing hat:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/player/transactions - Get transaction log history
app.get("/api/player/transactions", async (req, res) => {
    try {
        const playerName = req.query.name || "FlappyHero";
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const logs = await economyService.getTransactionLogs(playerName, limit);
        res.status(200).json({ success: true, logs });
    } catch (err) {
        console.error("[API] Error fetching transaction logs:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/auth/signup - Register new account in Player and Login tables
app.post("/api/auth/signup", async (req, res) => {
    try {
        const { username, password, playerName } = req.body || {};
        const result = await economyService.signUp(username, password, playerName);
        res.status(201).json(result);
    } catch (err) {
        const isConflict = err.message && err.message.includes("already taken");
        res.status(isConflict ? 409 : 400).json({ success: false, error: err.message });
    }
});

// POST /api/auth/signin (and /api/auth/login) - Authenticate existing player
app.post(["/api/auth/signin", "/api/auth/login"], async (req, res) => {
    try {
        const { username, password } = req.body || {};
        const result = await economyService.signIn(username, password);
        res.status(200).json(result);
    } catch (err) {
        res.status(401).json({ success: false, error: err.message });
    }
});

// GET /api/auth/me - Retrieve current profile by player_id or username
app.get("/api/auth/me", async (req, res) => {
    try {
        const { player_id, username } = req.query || {};
        const profile = await economyService.getAuthProfile(player_id, username);
        if (!profile) {
            return res.status(404).json({ success: false, error: "Account not found" });
        }
        res.status(200).json({ success: true, ...profile });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/auth/register-login - Plain-text login/registration in Login table (Legacy compatibility)
app.post("/api/auth/register-login", async (req, res) => {
    try {
        const { username, password, playerName } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: "Username and password required" });
        }
        // Try sign in first, if user doesn't exist, sign them up!
        try {
            const loginRes = await economyService.signIn(username, password);
            return res.status(200).json(loginRes);
        } catch (authErr) {
            if (authErr.message && (authErr.message.includes("Username not found") || authErr.message.includes("Invalid username or password"))) {
                try {
                    const signupRes = await economyService.signUp(username, password, playerName);
                    return res.status(200).json(signupRes);
                } catch (signupErr) {
                    throw authErr;
                }
            }
            throw authErr;
        }
    } catch (err) {
        console.error("[API] Error in register-login:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Instantiate Lobby Manager & WebSocket Handlers
const lobbyManager = new LobbyManager(clients);
initSocketHandler(wss, clients, lobbyManager, rankManager, economyService);

function startServer(portToUse) {
    server.removeAllListeners("error");
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.warn(`[Warning] Port ${portToUse} is in use. Trying port ${portToUse + 1}...`);
            startServer(portToUse + 1);
        } else {
            console.error("[Error] Server error:", err);
        }
    });

    server.listen(portToUse, () => {
        console.log(`====================================================`);
        console.log(` Flappy Bird Multiplayer Server running on port ${portToUse}`);
        console.log(` Environment: ${process.env.NODE_ENV || "development"}`);
        console.log(` Supabase DB: ${supabaseLeaderboard.isConfigured ? "Connected (Real DB)" : "Fallback (In-Memory Mock)"}`);
        console.log(` WebSocket: Native (ws) enabled`);
        console.log(` Open http://localhost:${portToUse} in your browser.`);
        console.log(`====================================================`);
    });
}

startServer(PORT);
