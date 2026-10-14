const Lobby = require("../models/Lobby");
const Player = require("../models/Player");
const { generateMapsAndCheckpoints } = require("./mapGenerator");
const GameEngine = require("./gameLoop");
const {
    CURSE_SPEED_MULTIPLIER,
    SPEED_BOOST_MULTIPLIER,
    CURSE_DURATION_MS,
    BUCKET_DURATION_MS,
    SHIELD_DURATION_MS,
    INVINCIBLE_DURATION_MS,
    SPEED_BOOST_DURATION_MS,
    ICE_DURATION_MS
} = require("../config/constants");

class LobbyManager {
    constructor(clients = new Map()) {
        this.clients = clients; // Map: player_id -> WebSocket (or legacy mock object)
        this.lobbies = new Map(); // Lobby_id -> Lobby
        this.playerLobbyMap = new Map(); // player_id -> Lobby_id
        this.gameEngines = new Map(); // Lobby_id -> GameEngine
    }

    // Helper: Send JSON message to a single client (by WebSocket object or player_id string)
    sendTo(wsOrId, type, data = {}) {
        let ws = null;
        if (typeof wsOrId === "string" && this.clients && typeof this.clients.get === "function") {
            ws = this.clients.get(wsOrId);
        } else if (wsOrId && typeof wsOrId.send === "function") {
            ws = wsOrId;
        }

        const payload = JSON.stringify({ type, data });
        if (ws && ws.readyState === 1) { // 1 = WebSocket.OPEN
            ws.send(payload);
        } else if (wsOrId && typeof wsOrId.emit === "function") {
            // Support for legacy mock socket instances in unit tests
            wsOrId.emit(type, data);
        } else if (this.clients && typeof this.clients.to === "function") {
            this.clients.to(wsOrId).emit(type, data);
        }
    }

    // Helper: Broadcast JSON message to all connected clients in a specific room
    broadcastToRoom(lobbyId, type, data = {}) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const payload = JSON.stringify({ type, data });
        if (this.clients && typeof this.clients.get === "function") {
            for (const playerId of lobby.players.keys()) {
                const ws = this.clients.get(playerId);
                if (ws && ws.readyState === 1) {
                    ws.send(payload);
                } else if (ws && typeof ws.emit === "function") {
                    ws.emit(type, data);
                }
            }
        } else if (this.clients && typeof this.clients.to === "function") {
            // Legacy mockIo support for unit tests
            this.clients.to(lobbyId).emit(type, data);
        }
    }

    // Helper: Broadcast JSON message to all connected WebSocket clients
    broadcast(data) {
        let payload;
        if (typeof data === "string") {
            payload = data;
        } else if (data && data.type) {
            payload = JSON.stringify(data);
        } else {
            payload = JSON.stringify({ type: "broadcast", data });
        }

        if (this.clients && typeof this.clients.values === "function") {
            for (const ws of this.clients.values()) {
                if (ws && ws.readyState === 1) {
                    ws.send(payload);
                }
            }
        } else if (this.clients && typeof this.clients.emit === "function") {
            this.clients.emit("broadcast", data);
        }
    }

    generateLobbyId() {
        let code = "";
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    getSocketId(socket) {
        if (!socket) return null;
        return socket.id || socket;
    }

    createLobby(socket, data) {
        const socketId = this.getSocketId(socket);
        let lobbyId = this.generateLobbyId();
        while (this.lobbies.has(lobbyId)) {
            lobbyId = this.generateLobbyId();
        }

        const player = new Player(socketId, data.name, data.skin_ID || 0, data.hat_ID || 0);
        player.ready_status = true; // Host is auto-ready

        const lobby = new Lobby(lobbyId, socketId);
        lobby.addPlayer(player);

        this.lobbies.set(lobbyId, lobby);
        this.playerLobbyMap.set(socketId, lobbyId);

        this.sendTo(socket, "lobby_created", {
            lobby: this.serializeLobby(lobby),
            playerId: socketId
        });
    }

    joinLobby(socket, data) {
        const socketId = this.getSocketId(socket);
        const lobbyId = (data.Lobby_id || "").toUpperCase().trim();
        const lobby = this.lobbies.get(lobbyId);

        if (!lobby) {
            return this.sendTo(socket, "error_message", { message: "Lobby not found. Please check code." });
        }

        if (lobby.status !== "waiting") {
            return this.sendTo(socket, "error_message", { message: "Match already in progress or completed." });
        }

        if (lobby.players.size >= 4) { // Max 4 players
            return this.sendTo(socket, "error_message", { message: "Lobby is full (Max 4 players)." });
        }

        const player = new Player(socketId, data.name, data.skin_ID || 0, data.hat_ID || 0);
        lobby.addPlayer(player);

        this.playerLobbyMap.set(socketId, lobbyId);

        this.sendTo(socket, "lobby_joined", {
            lobby: this.serializeLobby(lobby),
            playerId: socketId
        });

        this.broadcastToRoom(lobbyId, "lobby_updated", {
            lobby: this.serializeLobby(lobby)
        });
    }

    leaveLobby(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        // Mid-Match & Lobby Host Migration: Silent re-assignment if Host leaves
        if (lobby.host_ID === socketId && lobby.players.size > 1) {
            const remainingPlayers = Array.from(lobby.players.values()).filter(p => p.player_id !== socketId);
            const newHost = remainingPlayers[0];
            lobby.host_ID = newHost.player_id;
            newHost.ready_status = true; // New host auto-ready
        }

        lobby.removePlayer(socketId);
        this.playerLobbyMap.delete(socketId);

        this.sendTo(socket, "left_lobby", {});

        // Strict Anti-Ghost Room Garbage Collection
        if (lobby.players.size === 0) {
            this.destroyRoom(lobbyId);
        } else {
            this.broadcastToRoom(lobbyId, "lobby_updated", {
                lobby: this.serializeLobby(lobby)
            });
        }
    }

    destroyRoom(lobbyId) {
        const engine = this.gameEngines.get(lobbyId);
        if (engine) {
            engine.stop();
            this.gameEngines.delete(lobbyId);
        }
        this.lobbies.delete(lobbyId);
        console.log(`[GC] Room destroyed & memory cleared for Lobby ID: ${lobbyId}`);
    }

    destroyLobby(lobbyId) {
        this.destroyRoom(lobbyId);
    }

    kickPlayer(socket, data) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.host_ID !== socketId) {
            return this.sendTo(socket, "error_message", { message: "Only the Host can kick players." });
        }

        const targetPlayerId = data.targetPlayerId;
        if (!targetPlayerId || targetPlayerId === socketId) {
            return this.sendTo(socket, "error_message", { message: "Cannot kick yourself." });
        }

        const targetPlayer = lobby.players.get(targetPlayerId);
        if (targetPlayer) {
            this.sendTo(targetPlayerId, "player_kicked", {
                message: "You have been kicked from the lobby by the Host."
            });

            lobby.removePlayer(targetPlayerId);
            this.playerLobbyMap.delete(targetPlayerId);

            if (lobby.players.size === 0) {
                this.destroyRoom(lobbyId);
            } else {
                this.broadcastToRoom(lobbyId, "lobby_updated", {
                    lobby: this.serializeLobby(lobby)
                });
            }
        }
    }

    updateCustomization(socket, data) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const player = lobby.players.get(socketId);
        if (player) {
            if (data.skin_ID !== undefined) player.skin_ID = data.skin_ID;
            if (data.hat_ID !== undefined) player.hat_ID = data.hat_ID;
            if (data.name !== undefined && data.name.trim()) player.name = data.name.trim();

            this.broadcastToRoom(lobbyId, "lobby_updated", {
                lobby: this.serializeLobby(lobby)
            });
        }
    }

    toggleReady(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const player = lobby.players.get(socketId);
        if (player) {
            player.ready_status = !player.ready_status;

            this.broadcastToRoom(lobbyId, "lobby_updated", {
                lobby: this.serializeLobby(lobby)
            });
        }
    }

    updateLobbySettings(socket, data) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.host_ID !== socketId) {
            return this.sendTo(socket, "error_message", { message: "Only the Host can modify settings." });
        }

        if (data.mode_id) {
            lobby.mode_id = data.mode_id;
        }

        if (data.amount_of_map && [1, 3, 5].includes(Number(data.amount_of_map))) {
            lobby.amount_of_map = Number(data.amount_of_map);
        }

        this.broadcastToRoom(lobbyId, "lobby_updated", {
            lobby: this.serializeLobby(lobby)
        });
    }

    startMatch(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.host_ID !== socketId) {
            return this.sendTo(socket, "error_message", { message: "Only the Host can start the match." });
        }

        if (lobby.players.size < 2) {
            return this.sendTo(socket, "error_message", { message: "Minimum 2 players required to start match." });
        }

        if (!lobby.allPlayersReady()) {
            return this.sendTo(socket, "error_message", { message: "All players must be Ready before starting." });
        }

        // Generate Maps, Checkpoints, and Item Boxes
        this.initiateLoadingPhase(lobby);
    }

    playAgain(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.host_ID !== socketId) {
            return this.sendTo(socket, "error_message", { message: "Only the Host can restart the match." });
        }

        // Stop existing engine
        const oldEngine = this.gameEngines.get(lobbyId);
        if (oldEngine) oldEngine.stop();

        this.initiateLoadingPhase(lobby);
    }

    initiateLoadingPhase(lobby) {
        const lobbyId = lobby.Lobby_id;

        // Generate Maps, Checkpoints, and Item Boxes
        const mapData = generateMapsAndCheckpoints(lobby.amount_of_map, lobbyId, lobby.mode_id);
        lobby.maps = mapData.maps;
        lobby.checkpoints = mapData.checkpoints;
        lobby.itemBoxes = mapData.itemBoxes;
        lobby.startCheckpointId = mapData.startCheckpointId;
        lobby.finishLineX = mapData.finishLineX;
        lobby.totalPipes = mapData.totalPipes;

        lobby.status = "loading";
        lobby.loadingReadyPlayers.clear();

        if (lobby.loadingTimer) {
            clearTimeout(lobby.loadingTimer);
        }

        // 15-second loading timeout timer on server
        lobby.loadingTimer = setTimeout(() => {
            this.handleLoadingTimeout(lobbyId);
        }, 15000);

        this.broadcastToRoom(lobbyId, "match_loading", {
            lobby: this.serializeLobby(lobby),
            maps: lobby.maps,
            checkpoints: Array.from(lobby.checkpoints.values()),
            itemBoxes: (lobby.itemBoxes || []).map(b => this.serializeItemBox(b)),
            finishLineX: lobby.finishLineX,
            totalPipes: lobby.totalPipes,
            readyCount: 0,
            totalPlayers: lobby.players.size
        });
    }

    clientReady(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.status !== "loading") return;

        lobby.loadingReadyPlayers.add(socketId);
        const readyCount = lobby.loadingReadyPlayers.size;
        const totalPlayers = lobby.players.size;

        this.broadcastToRoom(lobbyId, "loading_progress", {
            readyCount: readyCount,
            totalPlayers: totalPlayers
        });

        if (readyCount >= totalPlayers) {
            this.startMatchFromLoading(lobbyId);
        }
    }

    handleLoadingTimeout(lobbyId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.status !== "loading") return;

        if (lobby.loadingTimer) {
            clearTimeout(lobby.loadingTimer);
            lobby.loadingTimer = null;
        }

        // Find unready players
        const unreadyPlayerIds = [];
        for (let pId of lobby.players.keys()) {
            if (!lobby.loadingReadyPlayers.has(pId)) {
                unreadyPlayerIds.push(pId);
            }
        }

        // Kick unready players
        for (let kickId of unreadyPlayerIds) {
            this.sendTo(kickId, "kicked", { message: "You have been kicked (Loading Timeout - Failed to load in time)." });
            this.playerLobbyMap.delete(kickId);
            lobby.removePlayer(kickId);
        }

        // Notify remaining players in room
        this.broadcastToRoom(lobbyId, "lobby_updated", {
            lobby: this.serializeLobby(lobby)
        });

        if (lobby.players.size === 0) {
            this.destroyLobby(lobbyId);
            return;
        }

        this.startMatchFromLoading(lobbyId);
    }

    startMatchFromLoading(lobbyId) {
        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.status !== "loading") return;

        if (lobby.loadingTimer) {
            clearTimeout(lobby.loadingTimer);
            lobby.loadingTimer = null;
        }

        lobby.status = "playing";

        // Initialize GameEngine with lobbyManager instance
        const engine = new GameEngine(lobby, this);
        this.gameEngines.set(lobbyId, engine);

        // Notify clients match is starting (3s countdown)
        this.broadcastToRoom(lobbyId, "match_starting", {
            lobby: this.serializeLobby(lobby),
            maps: lobby.maps,
            checkpoints: Array.from(lobby.checkpoints.values()),
            itemBoxes: (lobby.itemBoxes || []).map(b => this.serializeItemBox(b)),
            finishLineX: lobby.finishLineX,
            totalPipes: lobby.totalPipes,
            countdownSeconds: 3
        });

        setTimeout(() => {
            engine.start();
        }, 3000);
    }

    sendChatMessage(socket, data) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        const player = lobby.players.get(socketId);
        if (!player) return;

        const text = (data.message || "").trim();
        if (!text) return;

        this.broadcastToRoom(lobbyId, "receive_chat_message", {
            senderId: socketId,
            senderName: player.name,
            message: text,
            timestamp: Date.now()
        });
    }

    handlePlayerInput(socket, data) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const engine = this.gameEngines.get(lobbyId);
        if (engine) {
            engine.queueInput(socketId, data);
        }
    }

    handlePlayerDash(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const engine = this.gameEngines.get(lobbyId);
        if (engine) {
            engine.queueInput(socketId, { action: "dash" });
        }
    }

    returnToLobby(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby) return;

        // Only host can initiate return to lobby from post-match
        if (lobby.host_ID !== socketId) {
            return this.sendTo(socket, "error_message", { message: "Only the Host can return to lobby." });
        }

        const engine = this.gameEngines.get(lobbyId);
        if (engine) {
            engine.stop();
            this.gameEngines.delete(lobbyId);
        }

        lobby.status = "waiting";
        for (let p of lobby.players.values()) {
            p.ready_status = (p.player_id === lobby.host_ID); // Host ready by default
        }

        this.broadcastToRoom(lobbyId, "returned_to_lobby", {
            lobby: this.serializeLobby(lobby)
        });
    }

    useItem(socket) {
        const socketId = this.getSocketId(socket);
        const lobbyId = this.playerLobbyMap.get(socketId);
        if (!lobbyId) return;

        const lobby = this.lobbies.get(lobbyId);
        if (!lobby || lobby.status !== "playing") return;

        if (lobby.mode_id === "flappy_chained") {
            // Chained mode has no manual inventory item use - Lucky blocks are forced immediately upon contact!
            return;
        }

        const player = lobby.players.get(socketId);
        if (!player || !player.heldItem) return;

        const usedItem = player.heldItem;
        player.heldItem = null; // Item consumed

        if (usedItem === "shield") {
            player.hasShield = true;
            if (player.shieldTimer) clearTimeout(player.shieldTimer);

            player.shieldTimer = setTimeout(() => {
                player.hasShield = false;
                player.shieldTimer = null;
                this.broadcastToRoom(lobby.Lobby_id, "shield_expired", {
                    playerId: player.player_id
                });
            }, SHIELD_DURATION_MS);

            this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                userId: player.player_id,
                userName: player.name,
                itemType: "shield",
                targetId: player.player_id,
                targetName: player.name,
                effect: "shield_active"
            });
            return;
        }

        if (usedItem === "speed") {
            player.speedMultiplier = SPEED_BOOST_MULTIPLIER;
            if (player.speedTimer) clearTimeout(player.speedTimer);

            player.speedTimer = setTimeout(() => {
                player.speedMultiplier = 1.0;
                player.speedTimer = null;
            }, SPEED_BOOST_DURATION_MS);

            this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                userId: player.player_id,
                userName: player.name,
                itemType: "speed",
                targetId: player.player_id,
                targetName: player.name,
                duration: SPEED_BOOST_DURATION_MS
            });
            return;
        }

        if (usedItem === "swap") {
            if (lobby.mode_id === "flappy_chained") {
                // Random Position Swap: Shuffle ALL active players in the room!
                const activePlayers = Array.from(lobby.players.values()).filter(p => p.is_alive && !p.is_finished);
                if (activePlayers.length < 2) {
                    this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                        userId: player.player_id,
                        userName: player.name,
                        itemType: "swap",
                        wasted: true
                    });
                    return;
                }

                // Collect positions and permute them randomly
                const positions = activePlayers.map(p => ({ x: p.x, y: p.y, velocityY: p.velocityY }));
                for (let i = positions.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [positions[i], positions[j]] = [positions[j], positions[i]];
                }

                const swappedList = [];
                activePlayers.forEach((p, idx) => {
                    p.x = positions[idx].x;
                    p.y = positions[idx].y;
                    p.velocityY = positions[idx].velocityY;
                    swappedList.push({ playerId: p.player_id, name: p.name, x: p.x, y: p.y });
                });

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "swap",
                    isChaosSwap: true,
                    swappedPlayers: swappedList
                });
                return;
            }

            // Flappy Race mode: Pick a random active opponent in lobby
            const opponents = Array.from(lobby.players.values()).filter(p => p.player_id !== player.player_id && p.is_alive && !p.is_finished);
            if (opponents.length === 0) {
                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "swap",
                    wasted: true
                });
                return;
            }

            const targetPlayer = opponents[Math.floor(Math.random() * opponents.length)];

            if (targetPlayer.hasShield) {
                targetPlayer.hasShield = false;
                if (targetPlayer.shieldTimer) clearTimeout(targetPlayer.shieldTimer);
                targetPlayer.isInvincible = true;
                targetPlayer.invincibleTimer = setTimeout(() => {
                    targetPlayer.isInvincible = false;
                    this.broadcastToRoom(lobby.Lobby_id, "invincibility_expired", { playerId: targetPlayer.player_id });
                }, INVINCIBLE_DURATION_MS);

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "swap",
                    targetId: targetPlayer.player_id,
                    targetName: targetPlayer.name,
                    shieldBlocked: true
                });
                return;
            }

            if (targetPlayer.isInvincible) {
                this.broadcastToRoom(lobby.Lobby_id, "item_used", { userId: player.player_id, itemType: "swap", wasted: true });
                return;
            }

            // Swap physical positions
            const tempX = player.x;
            const tempY = player.y;
            player.x = targetPlayer.x;
            player.y = targetPlayer.y;
            targetPlayer.x = tempX;
            targetPlayer.y = tempY;

            this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                userId: player.player_id,
                userName: player.name,
                itemType: "swap",
                targetId: targetPlayer.player_id,
                targetName: targetPlayer.name
            });
            return;
        }

        if (usedItem === "ink" || usedItem === "curse" || usedItem === "deathnote" || usedItem === "ice") {
            let firstPlacePlayer = null;

            if (lobby.mode_id === "flappy_chained") {
                // In Chained Mode, target other active teammates
                const teammates = Array.from(lobby.players.values()).filter(p => p.player_id !== player.player_id && p.is_alive && !p.is_finished);
                if (teammates.length > 0) {
                    firstPlacePlayer = teammates[Math.floor(Math.random() * teammates.length)];
                }
            } else {
                // Find 1st place player (max X position among active non-finished players)
                let maxX = -1;
                for (let p of lobby.players.values()) {
                    if (p.is_alive && !p.is_finished && p.x > maxX) {
                        maxX = p.x;
                        firstPlacePlayer = p;
                    }
                }

                // If user is 1st place when using targeted attack, target 2nd place or waste if solo
                if (firstPlacePlayer && firstPlacePlayer.player_id === player.player_id) {
                    let secondPlacePlayer = null;
                    let secondMaxX = -1;
                    for (let p of lobby.players.values()) {
                        if (p.player_id !== player.player_id && p.is_alive && !p.is_finished && p.x > secondMaxX) {
                            secondMaxX = p.x;
                            secondPlacePlayer = p;
                        }
                    }
                    firstPlacePlayer = secondPlacePlayer;
                }
            }

            if (!firstPlacePlayer) {
                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: usedItem,
                    wasted: true
                });
                return;
            }

            // Check if target has active Shield
            if (firstPlacePlayer.hasShield) {
                firstPlacePlayer.hasShield = false; // Shield destroyed/consumed
                if (firstPlacePlayer.shieldTimer) {
                    clearTimeout(firstPlacePlayer.shieldTimer);
                    firstPlacePlayer.shieldTimer = null;
                }

                // Grant 3-second Invincibility post-block
                firstPlacePlayer.isInvincible = true;
                if (firstPlacePlayer.invincibleTimer) clearTimeout(firstPlacePlayer.invincibleTimer);
                firstPlacePlayer.invincibleTimer = setTimeout(() => {
                    firstPlacePlayer.isInvincible = false;
                    firstPlacePlayer.invincibleTimer = null;
                    this.broadcastToRoom(lobby.Lobby_id, "invincibility_expired", {
                        playerId: firstPlacePlayer.player_id
                    });
                }, INVINCIBLE_DURATION_MS);

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: usedItem,
                    targetId: firstPlacePlayer.player_id,
                    targetName: firstPlacePlayer.name,
                    shieldBlocked: true,
                    invincible: true
                });
                return;
            }

            if (firstPlacePlayer.isInvincible) {
                this.broadcastToRoom(lobby.Lobby_id, "item_used", { userId: player.player_id, itemType: usedItem, wasted: true });
                return;
            }

            // Apply item effect to target
            if (usedItem === "ink") {
                firstPlacePlayer.isBucketHead = true;
                if (firstPlacePlayer.bucketTimer) clearTimeout(firstPlacePlayer.bucketTimer);
                firstPlacePlayer.bucketTimer = setTimeout(() => {
                    firstPlacePlayer.isBucketHead = false;
                    firstPlacePlayer.bucketTimer = null;
                }, BUCKET_DURATION_MS);

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "ink",
                    targetId: firstPlacePlayer.player_id,
                    targetName: firstPlacePlayer.name,
                    duration: BUCKET_DURATION_MS
                });
            } else if (usedItem === "curse") {
                firstPlacePlayer.speedMultiplier = CURSE_SPEED_MULTIPLIER;
                if (firstPlacePlayer.curseTimer) clearTimeout(firstPlacePlayer.curseTimer);
                firstPlacePlayer.curseTimer = setTimeout(() => {
                    firstPlacePlayer.speedMultiplier = 1.0;
                    firstPlacePlayer.curseTimer = null;
                }, CURSE_DURATION_MS);

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "curse",
                    targetId: firstPlacePlayer.player_id,
                    targetName: firstPlacePlayer.name,
                    duration: CURSE_DURATION_MS
                });
            } else if (usedItem === "deathnote") {
                // Knockdown target 1st place to ground instead of instant checkpoint reset
                const engine = this.gameEngines.get(lobby.Lobby_id);
                if (engine && typeof engine.triggerKnockdown === "function") {
                    engine.triggerKnockdown(firstPlacePlayer);
                } else {
                    firstPlacePlayer.isKnockedDown = true;
                    firstPlacePlayer.knockdownUntil = Date.now() + 5000;
                    firstPlacePlayer.isReadyToFly = false;
                    firstPlacePlayer.y = 592;
                    firstPlacePlayer.velocityY = 0;
                }

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "deathnote",
                    targetId: firstPlacePlayer.player_id,
                    targetName: firstPlacePlayer.name
                });

                this.broadcastToRoom(lobby.Lobby_id, "deathnote_announcement", {
                    attackerId: player.player_id,
                    attackerName: player.name,
                    targetId: firstPlacePlayer.player_id,
                    targetName: firstPlacePlayer.name
                });
            } else if (usedItem === "ice") {
                firstPlacePlayer.isFrozenInIce = true;
                firstPlacePlayer.velocityY = 0;
                if (firstPlacePlayer.iceTimer) clearTimeout(firstPlacePlayer.iceTimer);
                firstPlacePlayer.iceTimer = setTimeout(() => {
                    firstPlacePlayer.isFrozenInIce = false;
                    firstPlacePlayer.iceTimer = null;
                }, ICE_DURATION_MS);

                this.broadcastToRoom(lobby.Lobby_id, "item_used", {
                    userId: player.player_id,
                    userName: player.name,
                    itemType: "ice",
                    targetId: firstPlacePlayer.player_id,
                    targetName: firstPlacePlayer.name,
                    duration: ICE_DURATION_MS
                });
            }
        }
    }

    handleDisconnect(socket) {
        this.leaveLobby(socket);
    }

    serializeItemBox(item) {
        return {
            id: item.id,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            collected: item.collected || false,
            isActive: item.isActive !== false,
            collectedBy: item.collectedBy || null
        };
    }

    serializePlayer(p) {
        return {
            player_id: p.player_id,
            name: p.name,
            skin_ID: p.skin_ID,
            hat_ID: p.hat_ID,
            ready_status: p.ready_status,
            x: p.x,
            y: p.y,
            velocityY: p.velocityY,
            last_processed_input: p.last_processed_input,
            is_finished: p.is_finished,
            finish_time: p.finish_time,
            last_pipe_passed: p.last_pipe_passed,
            is_alive: p.is_alive,
            crashed_at_pipe: p.crashed_at_pipe,
            chain_index: p.chain_index,
            wipes_caused: p.wipes_caused,
            heldItem: p.heldItem,
            hasShield: p.hasShield,
            isInvincible: p.isInvincible,
            speedMultiplier: p.speedMultiplier
        };
    }

    serializeLobby(lobby) {
        return {
            Lobby_id: lobby.Lobby_id,
            mode_id: lobby.mode_id,
            host_ID: lobby.host_ID,
            amount_of_map: lobby.amount_of_map,
            status: lobby.status,
            players: Array.from(lobby.players.values()).map(p => this.serializePlayer(p)),
            leaderboard: lobby.leaderboard
        };
    }
}

module.exports = LobbyManager;
