const crypto = require("crypto");
const supabaseLeaderboard = require("../services/supabaseClient");

class RankManager {
    constructor() {
        this.sessions = new Map(); // sessionId -> { socketId, playerName, startTime, status }
        this.socketSessionMap = new Map(); // socketId -> sessionId
    }

    startSession(socketId, playerName) {
        const sessionId = "rank_" + crypto.randomBytes(8).toString("hex");
        const cleanName = String(playerName || "FlappyHero").trim().slice(0, 16) || "FlappyHero";
        const session = {
            sessionId,
            socketId,
            playerName: cleanName,
            startTime: Date.now(),
            status: "active"
        };

        this.sessions.set(sessionId, session);
        if (socketId) {
            this.socketSessionMap.set(socketId, sessionId);
        }

        // Cleanup old sessions (older than 30 minutes)
        const now = Date.now();
        for (const [id, s] of this.sessions.entries()) {
            if (now - s.startTime > 30 * 60 * 1000) {
                this.sessions.delete(id);
            }
        }

        return {
            sessionId,
            startTime: session.startTime
        };
    }

    async handleGameOver(socketId, data = {}) {
        const { sessionId, score, playerName } = data;
        let session = sessionId ? this.sessions.get(sessionId) : null;

        if (!session && socketId && this.socketSessionMap.has(socketId)) {
            session = this.sessions.get(this.socketSessionMap.get(socketId));
        }

        const nameToUse = (session && session.playerName) ? session.playerName : (playerName || "FlappyHero");
        let rawScore = Math.max(0, parseInt(score, 10) || 0);
        let verifiedScore = rawScore;

        // Anti-Cheat & Physical Sanity Validation
        if (session && session.startTime) {
            const elapsedSeconds = Math.max(0.1, (Date.now() - session.startTime) / 1000);
            
            // Physics constraints:
            // Forward velocity: 160 px/s, pipe 1 at 420 (dist 320px -> ~2.0s), subsequent 220px apart (~1.37s)
            // Even under maximum speed boost/dash, minimum time per pipe is ~0.8s
            let maxAllowedScore = 0;
            if (elapsedSeconds >= 1.2) {
                maxAllowedScore = 1 + Math.floor(Math.max(0, elapsedSeconds - 1.5) / 0.8);
            }

            if (rawScore > maxAllowedScore) {
                console.warn(`[AntiCheat] Detected implausible score (${rawScore} pipes in ${elapsedSeconds.toFixed(1)}s). Clamped to ${maxAllowedScore}. Player: ${nameToUse}`);
                verifiedScore = maxAllowedScore;
            }

            session.status = "finished";
        }

        // Authoritative write directly to Supabase via backend service
        const result = await supabaseLeaderboard.recordScore(nameToUse, verifiedScore);
        return result;
    }

    async getLeaderboard(limit = 10) {
        return await supabaseLeaderboard.getTopScores(limit);
    }

    handleDisconnect(socketId) {
        if (!socketId) return;
        const sessionId = this.socketSessionMap.get(socketId);
        if (sessionId) {
            this.sessions.delete(sessionId);
            this.socketSessionMap.delete(socketId);
        }
    }
}

const rankManager = new RankManager();
module.exports = rankManager;
