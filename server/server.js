require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const LobbyManager = require("./game/lobbyManager");
const rankManager = require("./game/rankManager");
const supabaseLeaderboard = require("./services/supabaseClient");
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

// Instantiate Lobby Manager & WebSocket Handlers
const lobbyManager = new LobbyManager(clients);
initSocketHandler(wss, clients, lobbyManager, rankManager);

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
