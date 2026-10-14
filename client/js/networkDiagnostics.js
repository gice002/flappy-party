/**
 * Network Diagnostics & Condition Simulator Module
 * Flappy Bird Multiplayer (Network Programming & Distributed Systems)
 * 
 * Provides:
 * 1. PingTracker: Real-time Application-level RTT measurement, smoothed RTT (SRTT), jitter, quality classification.
 * 2. NetworkSimulator: Educational client-side simulation of latency, jitter, and message drops.
 */

class PingTracker {
    constructor() {
        this.intervalMs = 1000;
        this.timeoutMs = 2500;
        this.timer = null;
        this.seq = 0;
        this.pendingRequests = new Map(); // id -> sendTimestamp
        this.rttHistory = []; // last 10 RTT samples
        this.currentRtt = null;
        this.smoothedRtt = null;
        this.lastPongTime = 0;
        this.consecutiveMisses = 0;
        this.isConnected = false;
        this.onUpdateCallback = null;
    }

    start(sendPingFn, onUpdate = null) {
        this.stop();
        this.onUpdateCallback = onUpdate;
        this.isConnected = true;

        const pingTick = () => {
            if (!this.isConnected) return;

            const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

            // Check for timeout on older pending requests
            for (let [id, sendTime] of this.pendingRequests.entries()) {
                if (now - sendTime > this.timeoutMs) {
                    this.pendingRequests.delete(id);
                    this.consecutiveMisses++;
                }
            }

            // Create new ping request
            this.seq++;
            const id = `ping_${this.seq}_${Math.floor(Math.random() * 10000)}`;
            const sendTime = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            this.pendingRequests.set(id, sendTime);

            try {
                sendPingFn({ id, clientTime: sendTime });
            } catch (err) {
                console.warn("[NetworkDiagnostics] Failed to send ping:", err);
            }

            if (this.onUpdateCallback) {
                this.onUpdateCallback(this.getStatus());
            }
        };

        // Send first ping immediately
        pingTick();
        this.timer = setInterval(pingTick, this.intervalMs);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.pendingRequests.clear();
        this.isConnected = false;
        if (this.onUpdateCallback) {
            this.onUpdateCallback(this.getStatus());
        }
    }

    reset() {
        this.stop();
        this.rttHistory = [];
        this.currentRtt = null;
        this.smoothedRtt = null;
        this.lastPongTime = 0;
        this.consecutiveMisses = 0;
        this.seq = 0;
    }

    handlePong(data) {
        if (!data || data.id === undefined) return;
        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const sendTime = this.pendingRequests.get(data.id);

        if (sendTime === undefined) {
            // Unmatched or expired ping response
            return;
        }

        this.pendingRequests.delete(data.id);
        const sampleRtt = Math.max(0, now - sendTime);
        this.currentRtt = Math.round(sampleRtt);
        this.lastPongTime = now;
        this.consecutiveMisses = 0;

        // Smoothed RTT (Exponential moving average: alpha = 0.8)
        if (this.smoothedRtt === null) {
            this.smoothedRtt = sampleRtt;
        } else {
            this.smoothedRtt = (0.8 * this.smoothedRtt) + (0.2 * sampleRtt);
        }

        // Rolling history (max 10 samples)
        this.rttHistory.push(this.currentRtt);
        if (this.rttHistory.length > 10) {
            this.rttHistory.shift();
        }

        if (this.onUpdateCallback) {
            this.onUpdateCallback(this.getStatus());
        }
    }

    getStatus() {
        if (!this.isConnected) {
            return {
                status: "DISCONNECTED",
                text: "DISCONNECTED",
                color: "#888888",
                rtt: null,
                rttText: "--",
                srtt: null,
                minRtt: null,
                maxRtt: null,
                jitter: null
            };
        }

        const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (this.lastPongTime > 0 && (now - this.lastPongTime > this.timeoutMs || this.consecutiveMisses >= 3)) {
            return {
                status: "TIMEOUT",
                text: "TIMEOUT",
                color: "#d9534f",
                rtt: null,
                rttText: "TIMEOUT",
                srtt: this.smoothedRtt ? Math.round(this.smoothedRtt) : null,
                minRtt: null,
                maxRtt: null,
                jitter: null
            };
        }

        const srttVal = this.smoothedRtt !== null ? Math.round(this.smoothedRtt) : this.currentRtt;
        if (srttVal === null) {
            return {
                status: "CONNECTING",
                text: "MEASURING",
                color: "#f7d51d",
                rtt: null,
                rttText: "...",
                srtt: null,
                minRtt: null,
                maxRtt: null,
                jitter: null
            };
        }

        let minRtt = Math.min(...this.rttHistory);
        let maxRtt = Math.max(...this.rttHistory);
        let jitter = 0;
        if (this.rttHistory.length > 1) {
            let sumDiff = 0;
            for (let i = 1; i < this.rttHistory.length; i++) {
                sumDiff += Math.abs(this.rttHistory[i] - this.rttHistory[i - 1]);
            }
            jitter = Math.round(sumDiff / (this.rttHistory.length - 1));
        }

        let quality = "GOOD";
        let color = "#74bf2e"; // Green

        if (srttVal > 150) {
            quality = "HIGH";
            color = "#d9534f"; // Red
        } else if (srttVal >= 60) {
            quality = "FAIR";
            color = "#f7d51d"; // Yellow
        }

        return {
            status: quality,
            text: quality,
            color: color,
            rtt: this.currentRtt,
            rttText: `${srttVal}ms`,
            srtt: srttVal,
            minRtt: minRtt,
            maxRtt: maxRtt,
            jitter: jitter
        };
    }
}

class NetworkSimulator {
    constructor() {
        this.enabled = false;
        this.latency = 0; // 0 - 500 ms
        this.jitter = 0;  // 0 - 100 ms
        this.dropRate = 0; // 0 - 20 %
        this.direction = "both"; // "both", "outbound", "inbound"
        this.pendingTimers = new Set();
        this.stats = {
            outboundSent: 0,
            outboundDropped: 0,
            outboundDelayed: 0,
            inboundReceived: 0,
            inboundDropped: 0,
            inboundDelayed: 0
        };

        // Explicit list of gameplay application messages subject to simulation
        this.simulatedOutboundTypes = new Set(["player_input", "use_item"]);
        this.simulatedInboundTypes = new Set(["game_snapshot"]);

        // Messages strictly excluded from simulation (NEVER delayed or dropped)
        this.excludedTypes = new Set([
            "network_ping",
            "network_pong",
            "create_lobby",
            "join_lobby",
            "leave_lobby",
            "kick_player",
            "update_customization",
            "toggle_ready",
            "update_lobby_settings",
            "start_match",
            "play_again",
            "return_to_lobby",
            "client_ready",
            "match_loading",
            "loading_progress",
            "match_starting",
            "lobby_created",
            "lobby_joined",
            "lobby_updated",
            "left_lobby",
            "player_kicked",
            "kicked",
            "error_message"
        ]);
    }

    setOptions(opts = {}) {
        if (opts.enabled !== undefined) this.enabled = Boolean(opts.enabled);
        if (opts.latency !== undefined) this.latency = Math.max(0, Math.min(500, Number(opts.latency) || 0));
        if (opts.jitter !== undefined) this.jitter = Math.max(0, Math.min(100, Number(opts.jitter) || 0));
        if (opts.dropRate !== undefined) this.dropRate = Math.max(0, Math.min(20, Number(opts.dropRate) || 0));
        if (opts.direction !== undefined) {
            if (["both", "outbound", "inbound"].includes(opts.direction)) {
                this.direction = opts.direction;
            }
        }
        if (!this.enabled) {
            this.clearPending();
        }
    }

    clearPending() {
        for (let timerId of this.pendingTimers) {
            clearTimeout(timerId);
        }
        this.pendingTimers.clear();
    }

    reset() {
        this.clearPending();
        this.enabled = false;
        this.latency = 0;
        this.jitter = 0;
        this.dropRate = 0;
        this.direction = "both";
        this.stats = {
            outboundSent: 0,
            outboundDropped: 0,
            outboundDelayed: 0,
            inboundReceived: 0,
            inboundDropped: 0,
            inboundDelayed: 0
        };
    }

    // Calculate effective delay with uniform random jitter
    calculateDelay() {
        if (this.latency <= 0 && this.jitter <= 0) return 0;
        const jitterOffset = this.jitter > 0 ? (Math.random() * 2 - 1) * this.jitter : 0;
        return Math.max(0, Math.round(this.latency + jitterOffset));
    }

    // Check if message should be dropped
    shouldDrop() {
        if (this.dropRate <= 0) return false;
        return Math.random() * 100 < this.dropRate;
    }

    // Hook: Outbound message transmission (Client -> Server)
    simulateSend(type, data, sendImmediateFn) {
        if (!this.enabled || this.direction === "inbound" || this.excludedTypes.has(type) || !this.simulatedOutboundTypes.has(type)) {
            sendImmediateFn(type, data);
            return { action: "sent", delay: 0 };
        }

        // Drop simulation
        if (this.shouldDrop()) {
            this.stats.outboundDropped++;
            console.log(`[NetworkSimulator] Outbound message '${type}' dropped (Drop rate: ${this.dropRate}%)`);
            return { action: "dropped", delay: 0 };
        }

        const delay = this.calculateDelay();
        if (delay <= 0) {
            this.stats.outboundSent++;
            sendImmediateFn(type, data);
            return { action: "sent", delay: 0 };
        }

        this.stats.outboundDelayed++;
        const timerId = setTimeout(() => {
            this.pendingTimers.delete(timerId);
            sendImmediateFn(type, data);
        }, delay);
        this.pendingTimers.add(timerId);
        return { action: "delayed", delay: delay };
    }

    // Hook: Inbound message reception (Server -> Client)
    simulateReceive(msg, dispatchImmediateFn) {
        const type = msg && msg.type;
        if (!this.enabled || this.direction === "outbound" || !type || this.excludedTypes.has(type) || !this.simulatedInboundTypes.has(type)) {
            dispatchImmediateFn(msg);
            return { action: "dispatched", delay: 0 };
        }

        // Drop simulation
        if (this.shouldDrop()) {
            this.stats.inboundDropped++;
            console.log(`[NetworkSimulator] Inbound message '${type}' dropped (Drop rate: ${this.dropRate}%)`);
            return { action: "dropped", delay: 0 };
        }

        const delay = this.calculateDelay();
        if (delay <= 0) {
            this.stats.inboundReceived++;
            dispatchImmediateFn(msg);
            return { action: "dispatched", delay: 0 };
        }

        this.stats.inboundDelayed++;
        const timerId = setTimeout(() => {
            this.pendingTimers.delete(timerId);
            dispatchImmediateFn(msg);
        }, delay);
        this.pendingTimers.add(timerId);
        return { action: "delayed", delay: delay };
    }
}

// Module export for Node.js test environment & browser window
if (typeof module !== "undefined" && module.exports) {
    module.exports = { PingTracker, NetworkSimulator };
}

if (typeof window !== "undefined") {
    window.PingTracker = PingTracker;
    window.NetworkSimulator = NetworkSimulator;
}
