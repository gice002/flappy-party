const { performance } = require("perf_hooks");
const LeaderboardEntry = require("../models/Leaderboard");
const {
    TICK_RATE,
    TICK_INTERVAL,
    BIRD_WIDTH,
    BIRD_HEIGHT,
    GROUND_Y,
    GRAVITY,
    JUMP_VELOCITY,
    FORWARD_VELOCITY,
    CHAIN_SPACING_X,
    ITEM_RESPAWN_MS,
    ITEM_PICKUP_COOLDOWN_MS,
    DASH_COOLDOWN_MS,
    DASH_BURST_X,
    MAX_TETHER_DIST,
    TETHER_SPRING_FORCE
} = require("../config/constants");

class GameEngine {
    constructor(lobby, lobbyManager) {
        this.lobby = lobby;
        this.lobbyManager = lobbyManager;
        this.loopInterval = null;
        this.loopTimeout = null;
        this.isRunning = false;
        this.accumulator = 0;
        this.lastTime = 0;
        this.inputQueues = new Map(); // socketId -> Array of { sequence, action, timestamp }
        this.tickCount = 0;
    }

    broadcast(type, data) {
        if (this.lobbyManager && typeof this.lobbyManager.broadcastToRoom === "function") {
            this.lobbyManager.broadcastToRoom(this.lobby.Lobby_id, type, data);
        } else if (this.lobbyManager && typeof this.lobbyManager.to === "function") {
            // Fallback for legacy unit test mocks passing io object
            this.lobbyManager.to(this.lobby.Lobby_id).emit(type, data);
        }
    }

    start() {
        this.lobby.status = "playing";
        this.lobby.matchStartTime = Date.now();
        this.lobby.finishTimerStart = null;
        this.tickCount = 0;
        this.isRunning = true;
        this.accumulator = 0;
        this.lastTime = performance.now();

        // Reset all players to start checkpoint with strict horizontal offset in Chained Mode
        const startCheckpoint = (this.lobby.checkpoints && typeof this.lobby.checkpoints.get === "function")
            ? this.lobby.checkpoints.get(this.lobby.startCheckpointId)
            : null;
        const startX = startCheckpoint ? startCheckpoint.respawn_coordinate_x : 100;
        const startY = startCheckpoint ? startCheckpoint.respawn_coordinate_y : 320;

        let chainIdx = 0;
        for (let player of this.lobby.players.values()) {
            player.chain_index = chainIdx;
            const xOffset = (this.lobby.mode_id === "flappy_chained") ? (chainIdx * CHAIN_SPACING_X) : 0;
            player.resetForMatch(startX - xOffset, startY, this.lobby.startCheckpointId);
            this.inputQueues.set(player.player_id, []);
            chainIdx++;
        }

        // Start high-precision fixed timestep loop
        this.scheduleNextLoop();
    }

    stop() {
        this.isRunning = false;
        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
            this.loopTimeout = null;
        }
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }
    }

    scheduleNextLoop() {
        if (!this.isRunning) return;

        const now = performance.now();
        let frameTime = now - this.lastTime;
        this.lastTime = now;

        // Cap max delta time (250ms max) to prevent spiral of death during event loop lag/pauses
        if (frameTime > 250) {
            frameTime = 250;
        }

        this.accumulator += frameTime;

        // Process physics updates in discrete, fixed-size 16.66ms chunks
        while (this.accumulator >= TICK_INTERVAL) {
            this.tick();
            this.accumulator -= TICK_INTERVAL;

            // If tick() called endMatch() or stop(), abort remaining ticks immediately
            if (!this.isRunning) {
                break;
            }
        }

        if (!this.isRunning) return;

        // Dynamic sleep interval to lock game engine ticks strictly to 60 TPS (16.66ms per tick)
        const nextTickDelay = Math.max(0, Math.floor(TICK_INTERVAL - this.accumulator));
        this.loopTimeout = setTimeout(() => {
            this.scheduleNextLoop();
        }, nextTickDelay);
    }

    queueInput(playerId, inputData) {
        const queue = this.inputQueues.get(playerId);
        if (queue && inputData) {
            queue.push(inputData);
        }
    }

    tick() {
        if (this.lobby.status !== "playing") return;
        this.tickCount++;

        const now = Date.now();
        let anyCollisionInChained = false;
        let highestCheckpointInChained = this.lobby.startCheckpointId;

        // Phase 1: Status checks, process input queues, and apply individual movement
        for (let player of this.lobby.players.values()) {
            if (player.is_finished) continue;

            // Check Invincibility expiration (e.g. 4s post-recovery shield)
            if (player.isInvincible && player.invincibleUntil && now >= player.invincibleUntil) {
                player.isInvincible = false;
                player.invincibleUntil = null;
                this.broadcast("invincibility_expired", { playerId: player.player_id });
            }

            // Check Knockdown 5s timer
            if (player.isKnockedDown) {
                player.y = GROUND_Y - BIRD_HEIGHT;
                player.velocityY = 0;

                if (now >= player.knockdownUntil && !player.isReadyToFly) {
                    player.isReadyToFly = true;
                    this.broadcast("player_ready_to_fly", {
                        playerId: player.player_id
                    });
                }
            }

            // Process inputs queued for this player
            const inputs = this.inputQueues.get(player.player_id) || [];
            while (inputs.length > 0) {
                const input = inputs.shift();
                if (!input) continue; // Ignore null or undefined inputs

                if (input.action === "jump") {
                    if (player.isKnockedDown) {
                        if (player.isReadyToFly) {
                            // Flap to recover and get back into race
                            player.isKnockedDown = false;
                            player.isReadyToFly = false;
                            player.knockdownUntil = null;
                            player.velocityY = JUMP_VELOCITY;
                            // Immediate 4-second invincibility shield
                            player.isInvincible = true;
                            player.invincibleUntil = now + 4000;

                            this.broadcast("player_recovered", {
                                playerId: player.player_id,
                                x: player.x,
                                y: player.y,
                                invincibleMs: 4000
                            });
                        }
                        // If knocked down but not ready to fly yet (within 5s), jump input is ignored
                    } else if (!player.isFrozenInIce) {
                        player.velocityY = JUMP_VELOCITY;
                    }
                } else if (input.action === "dash") {
                    if (!player.isKnockedDown && !player.isFrozenInIce && !player.is_finished && player.is_alive) {
                        if (!player.dashCooldownUntil || now >= player.dashCooldownUntil) {
                            player.dashCooldownUntil = now + DASH_COOLDOWN_MS;
                            player.x += DASH_BURST_X;
                            player.velocityY = Math.min(player.velocityY, -1.5);
                            this.broadcast("player_dashed", {
                                playerId: player.player_id,
                                x: player.x,
                                y: player.y,
                                dashCooldownUntil: player.dashCooldownUntil
                            });
                        }
                    }
                }
                player.last_processed_input = input.sequence || player.last_processed_input;
            }

            // Apply strict uniform forward X velocity & individual Y gravity (modified by Knockdown/Curse/Ice debuffs)
            if (player.isKnockedDown) {
                // Forward movement is suspended during knockdown
                player.y = GROUND_Y - BIRD_HEIGHT;
                player.velocityY = 0;
            } else if (player.isFrozenInIce) {
                player.velocityY = 0;
            } else {
                player.x += FORWARD_VELOCITY * (player.speedMultiplier || 1.0);
                player.velocityY += GRAVITY;
                player.y = Math.max(0, player.y + player.velocityY);
            }
        }

        // Phase 2: Chained Mode Tether Physics (apply distance constraint & tension pull between connected birds)
        if (this.lobby.mode_id === "flappy_chained") {
            this.applyChainedTetherPhysics();
        }

        // Phase 3: Update progress, check collisions, item boxes, and finish line
        for (let player of this.lobby.players.values()) {
            if (player.is_finished) continue;

            // Check pipe progress and update checkpoint
            this.updatePlayerProgress(player);

            // Collision check
            const collided = this.checkCollisions(player);
            if (collided) {
                // Track culprit player who caused wipeout
                player.wipes_caused = (player.wipes_caused || 0) + 1;

                if (this.lobby.mode_id === "flappy_chained") {
                    anyCollisionInChained = true;
                    // Find highest checkpoint cleared by any player in chain
                    for (let p of this.lobby.players.values()) {
                        if (p.checkpoint_id) {
                            highestCheckpointInChained = p.checkpoint_id;
                        }
                    }
                } else {
                    // Flappy Race mode: Knockdown & Recovery instead of instant death
                    this.triggerKnockdown(player);
                }
            }

            // Item Box collection check
            this.checkItemBoxCollisions(player);

            // Finish Line check
            if (player.x >= this.lobby.finishLineX && !player.is_finished) {
                player.is_finished = true;
                const elapsedSec = ((now - this.lobby.matchStartTime) / 1000).toFixed(2);
                player.finish_time = elapsedSec + "s";

                // Start 10-second finish countdown if first player to finish
                if (this.lobby.finishTimerStart === null) {
                    this.lobby.finishTimerStart = now;
                    this.broadcast("finish_timer_started", {
                        countdownSeconds: 10
                    });
                }
            }
        }

        // Handle shared death in Flappy Chained mode
        if (anyCollisionInChained && this.lobby.mode_id === "flappy_chained") {
            for (let player of this.lobby.players.values()) {
                if (!player.is_finished) {
                    this.respawnPlayerAtCheckpoint(player, highestCheckpointInChained);
                }
            }
            this.broadcast("chained_wipeout", {
                checkpointId: highestCheckpointInChained
            });
        }

        // Check Finish Timer countdown (10s window)
        if (this.lobby.finishTimerStart !== null) {
            const elapsed = (now - this.lobby.finishTimerStart) / 1000;
            const remaining = Math.max(0, Math.ceil(10 - elapsed));

            // Check if all players finished
            let allFinished = true;
            for (let p of this.lobby.players.values()) {
                if (!p.is_finished) allFinished = false;
            }

            if (remaining <= 0 || allFinished) {
                this.endMatch();
                return;
            }
        }

        // Broadcast game snapshot to all clients in room
        this.broadcastSnapshot();
    }

    triggerPlayerDash(playerId) {
        const player = this.lobby.players.get(playerId);
        if (!player) return;
        const now = Date.now();
        if (!player.isKnockedDown && !player.isFrozenInIce && !player.is_finished && player.is_alive) {
            if (!player.dashCooldownUntil || now >= player.dashCooldownUntil) {
                player.dashCooldownUntil = now + DASH_COOLDOWN_MS;
                player.x += DASH_BURST_X;
                player.velocityY = Math.min(player.velocityY, -1.5);
                this.broadcast("player_dashed", {
                    playerId: player.player_id,
                    x: player.x,
                    y: player.y,
                    dashCooldownUntil: player.dashCooldownUntil
                });
            }
        }
    }

    applyChainedTetherPhysics() {
        if (this.lobby.mode_id !== "flappy_chained") return;

        // Collect all active non-finished players sorted strictly by chain_index
        const chained = Array.from(this.lobby.players.values())
            .filter(p => p.is_alive && !p.is_finished && !p.isKnockedDown)
            .sort((a, b) => a.chain_index - b.chain_index);

        if (chained.length < 2) return;

        // Apply distance constraint & tension pull between adjacent chained partners
        for (let i = 0; i < chained.length - 1; i++) {
            const pA = chained[i];
            const pB = chained[i + 1];

            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;
            const dist = Math.hypot(dx, dy);

            if (dist > MAX_TETHER_DIST && dist > 0.0001) {
                const stretch = dist - MAX_TETHER_DIST;
                const force = Math.min(stretch * TETHER_SPRING_FORCE, 10);
                const nx = dx / dist;
                const ny = dy / dist;

                // Restorative pull: pulls pA towards pB and pB towards pA
                pA.x += nx * force * 0.5;
                pA.y += ny * force * 0.5;
                pA.velocityY += ny * force * 0.15;

                pB.x -= nx * force * 0.5;
                pB.y -= ny * force * 0.5;
                pB.velocityY -= ny * force * 0.15;

                // Clamp Y bounds so players never clip through ground or ceiling
                pA.y = Math.max(0, Math.min(GROUND_Y - BIRD_HEIGHT, pA.y));
                pB.y = Math.max(0, Math.min(GROUND_Y - BIRD_HEIGHT, pB.y));
            }
        }
    }

    updatePlayerProgress(player) {
        let allPipes = [];
        for (let mapData of this.lobby.maps) {
            allPipes.push(...mapData.pipes);
        }

        for (let pipe of allPipes) {
            if (player.x > pipe.x + pipe.width) {
                if (pipe.pipeIndex > player.last_pipe_passed) {
                    player.last_pipe_passed = pipe.pipeIndex;
                }
            }
        }

        for (let [chkId, chk] of this.lobby.checkpoints.entries()) {
            if (player.x >= chk.respawn_coordinate_x - 50 && chkId !== this.lobby.startCheckpointId) {
                if (this.lobby.finishLineX > 0 && chk.respawn_coordinate_x >= this.lobby.finishLineX) {
                    continue;
                }
                player.checkpoint_id = chkId;
            }
        }
    }

    checkCollisions(player) {
        // Knocked down or Invincible players do not collide
        if (player.isKnockedDown || player.isInvincible) {
            return false;
        }

        if (player.y + BIRD_HEIGHT >= GROUND_Y) {
            return true;
        }

        let allPipes = [];
        for (let mapData of this.lobby.maps) {
            allPipes.push(...mapData.pipes);
        }

        const birdBox = { x: player.x, y: player.y, width: BIRD_WIDTH, height: BIRD_HEIGHT };

        for (let pipe of allPipes) {
            if (pipe.x > player.x + 100 || pipe.x + pipe.width < player.x - 50) continue;

            const topPipeBox = { x: pipe.x, y: pipe.topY, width: pipe.width, height: pipe.height };
            const bottomPipeBox = { x: pipe.x, y: pipe.bottomY, width: pipe.width, height: pipe.height };

            if (this.rectIntersect(birdBox, topPipeBox) || this.rectIntersect(birdBox, bottomPipeBox)) {
                player.crashed_at_pipe = pipe.pipeIndex;
                return true;
            }
        }

        return false;
    }

    checkItemBoxCollisions(player) {
        // Capacity: Players can hold a maximum of 1 item at a time
        if (player.heldItem !== null) return;

        // Pickup cooldown: 3 seconds after collecting a box, cannot pick up next box (anti-vertical-spam)
        const now = Date.now();
        if (player.itemPickupCooldownUntil && now < player.itemPickupCooldownUntil) return;

        const birdBox = { x: player.x, y: player.y, width: BIRD_WIDTH, height: BIRD_HEIGHT };

        for (let item of this.lobby.itemBoxes) {
            if (item.collected || item.isActive === false) continue;

            const itemBox = { x: item.x, y: item.y, width: item.width, height: item.height };
            if (this.rectIntersect(birdBox, itemBox)) {
                item.collected = true;
                item.isActive = false;
                item.collectedBy = player.player_id;

                const itemTypes = ["ink", "curse", "shield", "speed", "swap", "deathnote", "ice"];
                const acquiredItem = itemTypes[Math.floor(Math.random() * itemTypes.length)];
                player.heldItem = acquiredItem;
                player.itemPickupCooldownUntil = now + ITEM_PICKUP_COOLDOWN_MS;

                this.broadcast("item_collected", {
                    itemId: item.id,
                    playerId: player.player_id,
                    acquiredItem: acquiredItem,
                    pickupCooldownUntil: player.itemPickupCooldownUntil
                });

                // Exactly 3 seconds (3000ms) after being collected, the box must reactivate
                if (item.respawnTimer) clearTimeout(item.respawnTimer);
                item.respawnTimer = setTimeout(() => {
                    item.collected = false;
                    item.isActive = true;
                    item.collectedBy = null;
                    item.respawnTimer = null;
                    this.broadcast("item_respawned", {
                        itemId: item.id
                    });
                }, ITEM_RESPAWN_MS);
            }
        }
    }

    rectIntersect(a, b) {
        return a.x < b.x + b.width &&
               a.x + a.width > b.x &&
               a.y < b.y + b.height &&
               a.y + a.height > b.y;
    }

    triggerKnockdown(player) {
        if (player.isKnockedDown || player.isInvincible || player.is_finished) return;

        player.isKnockedDown = true;
        player.knockdownUntil = Date.now() + 5000;
        player.isReadyToFly = false;
        player.y = GROUND_Y - BIRD_HEIGHT; // 592
        player.velocityY = 0;

        if (player.isFrozenInIce) {
            player.isFrozenInIce = false;
            if (player.iceTimer) {
                clearTimeout(player.iceTimer);
                player.iceTimer = null;
            }
        }

        this.broadcast("player_knocked_down", {
            playerId: player.player_id,
            knockdownDurationMs: 5000,
            x: player.x,
            y: player.y
        });
    }

    respawnPlayer(player) {
        const chkId = player.checkpoint_id || this.lobby.startCheckpointId;
        this.respawnPlayerAtCheckpoint(player, chkId);
    }

    respawnPlayerAtCheckpoint(player, checkpointId) {
        const chk = this.lobby.checkpoints.get(checkpointId);
        const xOffset = (this.lobby.mode_id === "flappy_chained") ? (player.chain_index * CHAIN_SPACING_X) : 0;

        if (chk) {
            player.x = chk.respawn_coordinate_x - xOffset;
            player.y = chk.respawn_coordinate_y;
        } else {
            player.x = 100 - xOffset;
            player.y = 320;
        }
        player.velocityY = 0;
        player.isKnockedDown = false;
        player.isReadyToFly = false;
        player.knockdownUntil = null;

        this.broadcast("player_respawned", {
            playerId: player.player_id,
            checkpointId: checkpointId,
            x: player.x,
            y: player.y
        });
    }

    broadcastSnapshot() {
        const playersSnapshot = [];
        for (let p of this.lobby.players.values()) {
            playersSnapshot.push({
                player_id: p.player_id,
                name: p.name,
                skin_ID: p.skin_ID,
                hat_ID: p.hat_ID,
                x: p.x,
                y: p.y,
                velocityY: p.velocityY,
                last_processed_input: p.last_processed_input,
                is_finished: p.is_finished,
                finish_time: p.finish_time,
                last_pipe_passed: p.last_pipe_passed,
                checkpoint_id: p.checkpoint_id,
                chain_index: p.chain_index,
                heldItem: p.heldItem,
                itemPickupCooldownUntil: p.itemPickupCooldownUntil || null,
                dashCooldownUntil: p.dashCooldownUntil || null,
                hasShield: p.hasShield,
                isInvincible: p.isInvincible,
                invincibleUntil: p.invincibleUntil || null,
                isKnockedDown: p.isKnockedDown || false,
                knockdownUntil: p.knockdownUntil || null,
                isReadyToFly: p.isReadyToFly || false,
                isBucketHead: p.isBucketHead || false,
                isFrozenInIce: p.isFrozenInIce || false,
                speedMultiplier: p.speedMultiplier
            });
        }

        let remainingCountdown = null;
        if (this.lobby.finishTimerStart !== null) {
            const elapsed = (Date.now() - this.lobby.finishTimerStart) / 1000;
            remainingCountdown = Math.max(0, Math.ceil(10 - elapsed));
        }

        const sanitizedItemBoxes = (this.lobby.itemBoxes || []).map(item => ({
            id: item.id,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            collected: item.collected || false,
            isActive: item.isActive !== false,
            collectedBy: item.collectedBy || null
        }));

        this.broadcast("game_snapshot", {
            tick: this.tickCount,
            serverTime: Date.now(),
            players: playersSnapshot,
            itemBoxes: sanitizedItemBoxes,
            finishCountdown: remainingCountdown
        });
    }

    endMatch() {
        this.stop();
        this.lobby.status = "finished";

        const elapsedMs = Date.now() - this.lobby.matchStartTime;
        const minutes = Math.floor(elapsedMs / 60000);
        const seconds = Math.floor((elapsedMs % 60000) / 1000);
        const millis = Math.floor((elapsedMs % 1000) / 10);
        const teamTotalTimeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;

        const playerList = Array.from(this.lobby.players.values());
        
        const finishedPlayers = playerList.filter(p => p.is_finished);
        const dnfPlayers = playerList.filter(p => !p.is_finished);

        finishedPlayers.sort((a, b) => parseFloat(a.finish_time) - parseFloat(b.finish_time));
        dnfPlayers.sort((a, b) => b.last_pipe_passed - a.last_pipe_passed);

        const leaderboardEntries = [];
        let rank = 1;

        for (let p of finishedPlayers) {
            const lbEntry = new LeaderboardEntry(
                `lb_${this.lobby.Lobby_id}_${p.player_id}`,
                p.player_id,
                this.lobby.Lobby_id,
                p.finish_time,
                rank++,
                p.name,
                "FINISHED",
                p.wipes_caused || 0,
                p.skin_ID || 0,
                p.hat_ID || 0
            );
            leaderboardEntries.push(lbEntry);
        }

        for (let p of dnfPlayers) {
            const pipeNum = p.last_pipe_passed || p.crashed_at_pipe || 0;
            const statusStr = `[ OUT ] CRASHED AT PIPE ${pipeNum}`;
            const lbEntry = new LeaderboardEntry(
                `lb_${this.lobby.Lobby_id}_${p.player_id}`,
                p.player_id,
                this.lobby.Lobby_id,
                null,
                null,
                p.name,
                statusStr,
                p.wipes_caused || 0,
                p.skin_ID || 0,
                p.hat_ID || 0
            );
            leaderboardEntries.push(lbEntry);
        }

        this.lobby.leaderboard = leaderboardEntries;

        this.broadcast("match_finished", {
            lobby_id: this.lobby.Lobby_id,
            mode_id: this.lobby.mode_id,
            team_total_time: teamTotalTimeStr,
            leaderboard: leaderboardEntries
        });
    }
}

module.exports = GameEngine;
