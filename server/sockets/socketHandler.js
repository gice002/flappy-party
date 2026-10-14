const crypto = require("crypto");

function initSocketHandler(wss, clients, lobbyManager) {
    // Support both (wss, clients, lobbyManager) and (wss, lobbyManager)
    if (!lobbyManager && clients) {
        lobbyManager = clients;
        clients = new Map();
    }

    if (lobbyManager && !lobbyManager.clients) {
        lobbyManager.clients = clients || new Map();
    }

    // Support mock socket.io object if passed in unit tests
    if (wss && typeof wss.on === "function" && !wss.clients) {
        wss.on("connection", (socket) => {
            const playerId = socket.id || "p_" + crypto.randomBytes(4).toString("hex");
            socket.id = playerId;
            if (lobbyManager.clients) lobbyManager.clients.set(playerId, socket);

            const events = [
                "create_lobby", "join_lobby", "leave_lobby", "kick_player",
                "update_customization", "toggle_ready", "update_lobby_settings",
                "start_match", "play_again", "send_chat_message", "player_input",
                "return_to_lobby", "use_item", "client_ready", "player_dash"
            ];

            events.forEach(eventName => {
                socket.on(eventName, (data) => {
                    const camelMethod = eventName.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
                    if (typeof lobbyManager[camelMethod] === "function") {
                        lobbyManager[camelMethod](socket, data);
                    }
                });
            });

            socket.on("network_ping", (data) => {
                socket.emit("network_pong", {
                    id: (data && data.id) !== undefined ? data.id : null,
                    clientTime: (data && data.clientTime) !== undefined ? data.clientTime : 0
                });
            });

            socket.on("disconnect", () => {
                lobbyManager.handleDisconnect(socket);
                if (lobbyManager.clients) lobbyManager.clients.delete(playerId);
            });
        });
        return;
    }

    // 15-second Heartbeat Keep-Alive Loop for Cloudflare Tunnel / Reverse Proxies
    const heartbeatInterval = setInterval(() => {
        if (!wss || !wss.clients) return;
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                console.log(`[WebSocket] Pruning dead ghost socket: ${ws.id}`);
                ws.terminate();
                if (clients && ws.id) clients.delete(ws.id);
                continue;
            }
            ws.isAlive = false;
            try {
                ws.ping();
            } catch (err) {
                console.error(`[WebSocket] Ping error for ${ws.id}:`, err);
            }
        }
    }, 15000);

    if (wss && typeof wss.on === "function") {
        wss.on("close", () => {
            clearInterval(heartbeatInterval);
        });
    }

    wss.on("connection", (ws, req) => {
        // Assign a unique player_id to the socket reference
        const playerId = "p_" + crypto.randomBytes(4).toString("hex");
        ws.id = playerId;
        ws.isAlive = true;
        if (clients) clients.set(playerId, ws);

        console.log(`[WebSocket] Client connected: ${ws.id}`);

        ws.on("pong", () => {
            ws.isAlive = true;
        });

        ws.on("message", (message) => {
            let parsed;
            try {
                parsed = JSON.parse(message.toString());
            } catch (err) {
                console.error("[WebSocket] Malformed JSON message received:", err);
                return;
            }

            const type = parsed.type;
            const data = parsed.data || {};

            switch (type) {
                case "create_lobby":
                    lobbyManager.createLobby(ws, data);
                    break;
                case "join_lobby":
                    lobbyManager.joinLobby(ws, data);
                    break;
                case "leave_lobby":
                    lobbyManager.leaveLobby(ws);
                    break;
                case "kick_player":
                    lobbyManager.kickPlayer(ws, data);
                    break;
                case "update_customization":
                    lobbyManager.updateCustomization(ws, data);
                    break;
                case "toggle_ready":
                    lobbyManager.toggleReady(ws);
                    break;
                case "update_lobby_settings":
                    lobbyManager.updateLobbySettings(ws, data);
                    break;
                case "start_match":
                    lobbyManager.startMatch(ws);
                    break;
                case "play_again":
                    lobbyManager.playAgain(ws);
                    break;
                case "send_chat_message":
                    lobbyManager.sendChatMessage(ws, data);
                    break;
                case "player_input":
                    lobbyManager.handlePlayerInput(ws, data);
                    break;
                case "return_to_lobby":
                    lobbyManager.returnToLobby(ws);
                    break;
                case "use_item":
                    lobbyManager.useItem(ws);
                    break;
                case "player_dash":
                    lobbyManager.handlePlayerDash(ws);
                    break;
                case "client_ready":
                    lobbyManager.clientReady(ws);
                    break;
                case "network_ping":
                    if (ws.readyState === 1) { // 1 === WebSocket.OPEN
                        ws.send(JSON.stringify({
                            type: "network_pong",
                            data: {
                                id: (data && data.id) !== undefined ? data.id : null,
                                clientTime: (data && data.clientTime) !== undefined ? data.clientTime : 0
                            }
                        }));
                    }
                    break;
                default:
                    console.warn(`[WebSocket] Unknown event type: ${type}`);
            }
        });

        ws.on("close", () => {
            console.log(`[WebSocket] Client disconnected: ${ws.id}`);
            lobbyManager.handleDisconnect(ws);
            if (clients) clients.delete(ws.id);
        });

        ws.on("error", (err) => {
            console.error(`[WebSocket] Error for client ${ws.id}:`, err);
        });
    });
}

module.exports = initSocketHandler;
