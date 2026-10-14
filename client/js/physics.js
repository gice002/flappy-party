class PhysicsEngine {
    constructor() {
        this.gravity = 0.4;
        this.jumpVelocity = -6;
        this.forwardVelocity = 2.0;
        this.birdWidth = 34;
        this.birdHeight = 24;
        this.groundY = 616;

        this.inputSequence = 0;
        this.pendingInputs = []; // Array of { sequence, action, timestamp }
        
        // Local prediction state
        this.localPlayerId = null;
        this.predictedState = {
            x: 100,
            y: 320,
            velocityY: 0
        };

        // Interpolated remote players state map: playerId -> playerObj
        this.remotePlayers = new Map();
        this.isFrozen = false;
        this.localIsFinished = false;
        this.localIsFrozenInIce = false;
        this.localSpeedMultiplier = 1.0;
        this.localHasShield = false;
        this.localIsInvincible = false;
        this.localInvincibleUntil = null;
        this.localIsKnockedDown = false;
        this.localKnockdownUntil = null;
        this.localIsReadyToFly = false;
        this.localKnockdownPhase = "none"; // "none" | "falling" | "grounded"
        this.knockdownBounceVx = 0;
        this.knockdownBounceCount = 0;
        this.localHeldItem = null;
        this.localItemPickupCooldownUntil = null;
        this.localDashCooldownUntil = null;
        this.localChainIndex = 0;
        this.lastSnapshotTick = 0;
    }

    setLocalPlayerId(id) {
        this.localPlayerId = id;
    }

    clearRemotePlayers() {
        this.remotePlayers.clear();
    }

    resetLocalState(startX, startY) {
        this.predictedState = {
            x: startX,
            y: startY,
            velocityY: 0
        };
        this.inputSequence = 0;
        this.pendingInputs = [];
        this.isFrozen = false;
        this.localIsFinished = false;
        this.localIsFrozenInIce = false;
        this.localSpeedMultiplier = 1.0;
        this.localHasShield = false;
        this.localIsInvincible = false;
        this.localInvincibleUntil = null;
        this.localIsKnockedDown = false;
        this.localKnockdownUntil = null;
        this.localIsReadyToFly = false;
        this.localKnockdownPhase = "none";
        this.knockdownBounceVx = 0;
        this.knockdownBounceCount = 0;
        this.localHeldItem = null;
        this.localItemPickupCooldownUntil = null;
        this.localDashCooldownUntil = null;
        this.localChainIndex = 0;
        this.localIsDeadInBoss = false;
        this.lastSnapshotTick = 0;
        this.clearRemotePlayers(); // Enforce strict state wipe on local reset
    }

    // Trigger local knockdown animation with backward bounce and gravity drop
    triggerKnockdown(originX, originY, durationMs = 5000) {
        this.localIsKnockedDown = true;
        this.localKnockdownUntil = Date.now() + durationMs;
        this.localIsReadyToFly = false;
        this.knockdownBounceCount = 0;

        if (originX !== undefined && originX !== null) {
            this.predictedState.x = originX;
        }
        if (originY !== undefined && originY !== null && originY < (this.groundY - this.birdHeight)) {
            this.predictedState.y = originY;
        }

        const targetGroundY = this.groundY - this.birdHeight; // 592
        if (this.predictedState.y >= targetGroundY - 6) {
            this.predictedState.y = targetGroundY;
            this.predictedState.velocityY = -2.5; // Small ground bounce
            this.knockdownBounceVx = -1.5;
            this.localKnockdownPhase = "falling";
        } else {
            // Mid-air bounce upward and backward
            this.predictedState.velocityY = -4.5;
            this.knockdownBounceVx = -2.5;
            this.localKnockdownPhase = "falling";
        }
    }

    // Trigger remote player knockdown animation with backward bounce and gravity drop
    triggerRemoteKnockdown(playerId, originX, originY, durationMs = 5000) {
        const remote = this.remotePlayers.get(playerId);
        if (!remote) return;
        remote.isKnockedDown = true;
        remote.knockdownUntil = Date.now() + durationMs;
        remote.isReadyToFly = false;
        remote.knockdownBounceCount = 0;

        if (originX !== undefined && originX !== null) remote.x = originX;
        if (originY !== undefined && originY !== null && originY < (this.groundY - this.birdHeight)) {
            remote.y = originY;
        }

        const targetGroundY = this.groundY - this.birdHeight;
        if (remote.y >= targetGroundY - 6) {
            remote.y = targetGroundY;
            remote.velocityY = -2.5;
            remote.knockdownVx = -1.5;
            remote.knockdownPhase = "falling";
        } else {
            remote.velocityY = -4.5;
            remote.knockdownVx = -2.5;
            remote.knockdownPhase = "falling";
        }
    }

    // Process local jump input instantly for zero latency
    handleLocalJump() {
        if (this.isFrozen || this.localIsFinished || this.localIsFrozenInIce || this.localIsDeadInBoss) return null;

        if (this.localIsKnockedDown) {
            if (this.localIsDeadInBoss) return null;
            const now = Date.now();
            const isReady = this.localIsReadyToFly || (this.localKnockdownUntil && now >= this.localKnockdownUntil);
            if (!isReady) {
                // Ignore jump input while knocked down before 5 seconds
                return null;
            }
            // Recovery Jump!
            this.localIsKnockedDown = false;
            this.localIsReadyToFly = false;
            this.localKnockdownUntil = null;
            this.localIsInvincible = true;
            this.localInvincibleUntil = now + 4000;
            this.predictedState.velocityY = this.jumpVelocity;

            if (typeof window !== "undefined" && typeof window.onPlayerFlap === "function") {
                window.onPlayerFlap(this.predictedState.x, this.predictedState.y, window.playerSkinId || 0, true);
            }

            this.inputSequence++;
            const input = {
                sequence: this.inputSequence,
                action: "jump",
                timestamp: now
            };
            this.pendingInputs.push(input);
            return input;
        }

        this.inputSequence++;
        const input = {
            sequence: this.inputSequence,
            action: "jump",
            timestamp: Date.now()
        };

        // Apply instant jump locally
        this.predictedState.velocityY = this.jumpVelocity;
        
        if (typeof window !== "undefined" && typeof window.onPlayerFlap === "function") {
            window.onPlayerFlap(this.predictedState.x, this.predictedState.y, window.playerSkinId || 0, true);
        }

        // Queue input for reconciliation
        this.pendingInputs.push(input);

        return input;
    }

    // Process local dash input instantly with cooldown check
    handleLocalDash() {
        if (this.isFrozen || this.localIsFinished || this.localIsFrozenInIce || this.localIsKnockedDown) return null;
        const now = Date.now();
        if (this.localDashCooldownUntil && now < this.localDashCooldownUntil) return null;

        this.localDashCooldownUntil = now + 3500;
        this.predictedState.x += 65;
        this.predictedState.velocityY = Math.min(this.predictedState.velocityY, -1.5);

        this.inputSequence++;
        const input = {
            sequence: this.inputSequence,
            action: "dash",
            timestamp: now
        };
        this.pendingInputs.push(input);

        return input;
    }

    // Step local physics frame (at 60 FPS)
    updateLocalPhysics() {
        if (this.isFrozen || this.localIsFinished || this.localIsFrozenInIce) {
            this.predictedState.velocityY = 0;
            return;
        }

        // Local check for invincibility expiration
        if (this.localIsInvincible && this.localInvincibleUntil && Date.now() >= this.localInvincibleUntil) {
            this.localIsInvincible = false;
            this.localInvincibleUntil = null;
        }

        if (this.localIsKnockedDown) {
            if (this.localKnockdownUntil && Date.now() >= this.localKnockdownUntil) {
                this.localIsReadyToFly = true;
            }

            if (this.localKnockdownPhase === "falling") {
                this.predictedState.x += this.knockdownBounceVx;
                this.knockdownBounceVx *= 0.88;

                this.predictedState.velocityY += this.gravity * 1.4;
                this.predictedState.y += this.predictedState.velocityY;

                const targetGroundY = this.groundY - this.birdHeight; // 592
                if (this.predictedState.y >= targetGroundY) {
                    this.predictedState.y = targetGroundY;
                    if (this.knockdownBounceCount === 0 && Math.abs(this.predictedState.velocityY) > 2.0) {
                        this.predictedState.velocityY = -1.8;
                        this.knockdownBounceCount++;
                        if (typeof window !== "undefined" && typeof window.onGroundImpact === "function") {
                            window.onGroundImpact(this.predictedState.x, targetGroundY, true);
                        }
                    } else {
                        this.predictedState.velocityY = 0;
                        this.knockdownBounceVx = 0;
                        this.localKnockdownPhase = "grounded";
                        if (typeof window !== "undefined" && typeof window.onGroundImpact === "function") {
                            window.onGroundImpact(this.predictedState.x, targetGroundY, true);
                        }
                    }
                }
            } else {
                this.predictedState.y = this.groundY - this.birdHeight;
                this.predictedState.velocityY = 0;
                this.knockdownBounceVx = 0;
            }
            return;
        }

        const isBossMode = (typeof window !== "undefined" && window.currentLobby && window.currentLobby.mode_id === "flappy_boss");
        const isVictoryRun = (typeof window !== "undefined" && window.currentBossState && window.currentBossState.status === "victory_run");

        if (!isBossMode || isVictoryRun) {
            const speedMult = (this.localSpeedMultiplier !== undefined && this.localSpeedMultiplier !== null) ? this.localSpeedMultiplier : 1.0;
            this.predictedState.x += this.forwardVelocity * speedMult;
        }
        this.predictedState.velocityY += this.gravity;
        this.predictedState.y = Math.max(0, this.predictedState.y + this.predictedState.velocityY);

        // Apply client-side predicted tether constraint with adjacent chained partners
        if (typeof window !== "undefined" && window.currentLobby && window.currentLobby.mode_id === "flappy_chained") {
            const localChainIdx = this.localChainIndex || 0;
            for (let remote of this.remotePlayers.values()) {
                if (remote.is_finished) continue;
                const rIdx = remote.chain_index !== undefined ? remote.chain_index : 0;
                if (Math.abs(rIdx - localChainIdx) === 1) {
                    const dx = remote.x - this.predictedState.x;
                    const dy = remote.y - this.predictedState.y;
                    const dist = Math.hypot(dx, dy);
                    const MAX_TETHER = 110;
                    if (dist > MAX_TETHER && dist > 0.0001) {
                        const stretch = dist - MAX_TETHER;
                        const force = Math.min(stretch * 0.18, 8);
                        const nx = dx / dist;
                        const ny = dy / dist;
                        this.predictedState.x += nx * force * 0.5;
                        this.predictedState.y += ny * force * 0.5;
                        this.predictedState.velocityY += ny * force * 0.15;
                    }
                }
            }
        }

        // Ground limit
        if (this.predictedState.y + this.birdHeight > this.groundY) {
            this.predictedState.y = this.groundY - this.birdHeight;
            this.predictedState.velocityY = 0;
        }
    }

    // Reconcile with authoritative Server Snapshot
    reconcileServerSnapshot(snapshot) {
        if (!snapshot || !snapshot.players) return;

        // Out-of-order snapshot protection (e.g. from network latency/jitter simulation)
        if (snapshot.tick !== undefined && snapshot.tick !== null) {
            if (this.lastSnapshotTick && snapshot.tick < this.lastSnapshotTick) {
                return; // Discard outdated snapshot
            }
            this.lastSnapshotTick = snapshot.tick;
        }

        // Build active player ID set from snapshot to prune disconnected / stale ghosts
        const activeServerPlayerIds = new Set(snapshot.players.map(p => p.player_id));

        for (let remoteId of Array.from(this.remotePlayers.keys())) {
            if (!activeServerPlayerIds.has(remoteId)) {
                this.remotePlayers.delete(remoteId); // Remove ghost player
            }
        }

        for (let serverPlayer of snapshot.players) {
            if (serverPlayer.player_id === this.localPlayerId) {
                const hadShield = this.localHasShield;
                const wasFrozen = this.localIsFrozenInIce;

                this.localHasShield = serverPlayer.hasShield || false;
                this.localIsInvincible = serverPlayer.isInvincible || false;
                this.localInvincibleUntil = serverPlayer.invincibleUntil || null;
                this.localIsKnockedDown = serverPlayer.isKnockedDown || false;
                this.localKnockdownUntil = serverPlayer.knockdownUntil || null;
                this.localIsReadyToFly = serverPlayer.isReadyToFly || false;
                this.localHeldItem = serverPlayer.heldItem || null;
                this.localItemPickupCooldownUntil = serverPlayer.itemPickupCooldownUntil || null;
                this.localDashCooldownUntil = serverPlayer.dashCooldownUntil || null;
                this.localChainIndex = serverPlayer.chain_index !== undefined ? serverPlayer.chain_index : 0;
                this.localSpeedMultiplier = (serverPlayer.speedMultiplier !== undefined && serverPlayer.speedMultiplier !== null) ? serverPlayer.speedMultiplier : 1.0;
                this.localIsFinished = serverPlayer.is_finished || false;
                this.localIsFrozenInIce = serverPlayer.isFrozenInIce || false;
                this.localIsBucketHead = serverPlayer.isBucketHead || false;
                this.localBossLives = serverPlayer.bossLives !== undefined ? serverPlayer.bossLives : 2;
                this.localIsDeadInBoss = serverPlayer.isDeadInBoss || false;

                // Detect status transition triggers for local player
                if (hadShield && !this.localHasShield) {
                    if (typeof window !== "undefined" && typeof window.onShieldBreak === "function") {
                        window.onShieldBreak(this.predictedState.x, this.predictedState.y);
                    }
                }
                if (wasFrozen && !this.localIsFrozenInIce) {
                    if (typeof window !== "undefined" && typeof window.onIceShatter === "function") {
                        window.onIceShatter(this.predictedState.x, this.predictedState.y);
                    }
                }

                if (this.localIsFinished) {
                    this.predictedState.x = serverPlayer.x;
                    this.predictedState.y = serverPlayer.y;
                    this.predictedState.velocityY = 0;
                    this.pendingInputs = [];
                    continue;
                }

                if (this.localIsKnockedDown) {
                    if (this.localKnockdownPhase === "falling") {
                        // Let local falling animation proceed smoothly
                        this.pendingInputs = [];
                        continue;
                    }
                    this.predictedState.x = serverPlayer.x;
                    this.predictedState.y = this.groundY - this.birdHeight;
                    this.predictedState.velocityY = 0;
                    this.pendingInputs = [];
                    continue;
                }

                if (this.localIsFrozenInIce) {
                    this.predictedState.x = serverPlayer.x;
                    this.predictedState.y = serverPlayer.y;
                    this.predictedState.velocityY = 0;
                    this.pendingInputs = [];
                    continue;
                }

                // Server baseline position
                let reconciledX = serverPlayer.x;
                let reconciledY = serverPlayer.y;
                let reconciledVY = serverPlayer.velocityY;

                // Remove inputs that the server has already processed
                const lastAck = serverPlayer.last_processed_input || 0;
                this.pendingInputs = this.pendingInputs.filter(input => input.sequence > lastAck);

                const speedMult = this.localSpeedMultiplier;

                // Replay unacknowledged inputs on top of server baseline
                for (let input of this.pendingInputs) {
                    if (input.action === "jump") {
                        reconciledVY = this.jumpVelocity;
                    } else if (input.action === "dash") {
                        reconciledX += 65;
                        reconciledVY = Math.min(reconciledVY, -1.5);
                    }
                    reconciledX += this.forwardVelocity * speedMult;
                    reconciledVY += this.gravity;
                    reconciledY = Math.max(0, reconciledY + reconciledVY);
                }
                // Smooth correction / Reconciliation threshold
                const diffX = Math.abs(this.predictedState.x - reconciledX);
                const diffY = Math.abs(this.predictedState.y - reconciledY);

                if (diffX > 50 || diffY > 50) {
                    // Hard snap if major desync
                    this.predictedState.x = reconciledX;
                    this.predictedState.y = reconciledY;
                    this.predictedState.velocityY = reconciledVY;
                } else {
                    // Smooth lerp correction
                    this.predictedState.x += (reconciledX - this.predictedState.x) * 0.3;
                    this.predictedState.y += (reconciledY - this.predictedState.y) * 0.3;
                    this.predictedState.velocityY = reconciledVY;
                }
            } else {
                // Remote Player State handling
                let remote = this.remotePlayers.get(serverPlayer.player_id);
                if (!remote) {
                    remote = {
                        player_id: serverPlayer.player_id,
                        name: serverPlayer.name,
                        skin_ID: serverPlayer.skin_ID,
                        hat_ID: serverPlayer.hat_ID,
                        x: serverPlayer.x,
                        y: serverPlayer.y,
                        velocityY: serverPlayer.velocityY,
                        targetX: serverPlayer.x,
                        targetY: serverPlayer.y,
                        targetVelocityY: serverPlayer.velocityY,
                        is_finished: serverPlayer.is_finished,
                        finish_time: serverPlayer.finish_time,
                        chain_index: serverPlayer.chain_index,
                        hasShield: serverPlayer.hasShield,
                        isInvincible: serverPlayer.isInvincible,
                        invincibleUntil: serverPlayer.invincibleUntil,
                        isKnockedDown: serverPlayer.isKnockedDown,
                        knockdownUntil: serverPlayer.knockdownUntil,
                        isReadyToFly: serverPlayer.isReadyToFly,
                        knockdownPhase: serverPlayer.isKnockedDown ? "grounded" : "none",
                        isBucketHead: serverPlayer.isBucketHead,
                        isFrozenInIce: serverPlayer.isFrozenInIce,
                        heldItem: serverPlayer.heldItem,
                        dashCooldownUntil: serverPlayer.dashCooldownUntil || null,
                        speedMultiplier: serverPlayer.speedMultiplier,
                        bossLives: serverPlayer.bossLives !== undefined ? serverPlayer.bossLives : 2,
                        isDeadInBoss: serverPlayer.isDeadInBoss || false
                    };
                    this.remotePlayers.set(serverPlayer.player_id, remote);
                } else {
                    if (!remote.isKnockedDown && serverPlayer.isKnockedDown) {
                        this.triggerRemoteKnockdown(serverPlayer.player_id, remote.x, remote.y, 5000);
                    }
                    if (remote.hasShield && !serverPlayer.hasShield) {
                        if (typeof window !== "undefined" && typeof window.onShieldBreak === "function") {
                            window.onShieldBreak(remote.x, remote.y);
                        }
                    }
                    if (remote.isFrozenInIce && !serverPlayer.isFrozenInIce) {
                        if (typeof window !== "undefined" && typeof window.onIceShatter === "function") {
                            window.onIceShatter(remote.x, remote.y);
                        }
                    }
                    remote.name = serverPlayer.name;
                    remote.skin_ID = serverPlayer.skin_ID;
                    remote.hat_ID = serverPlayer.hat_ID;
                    remote.targetX = serverPlayer.x;
                    remote.targetY = serverPlayer.y;
                    remote.targetVelocityY = serverPlayer.velocityY;
                    remote.is_finished = serverPlayer.is_finished;
                    remote.finish_time = serverPlayer.finish_time;
                    remote.chain_index = serverPlayer.chain_index;
                    remote.dashCooldownUntil = serverPlayer.dashCooldownUntil || null;
                    remote.hasShield = serverPlayer.hasShield;
                    remote.isInvincible = serverPlayer.isInvincible;
                    remote.invincibleUntil = serverPlayer.invincibleUntil;
                    remote.isKnockedDown = serverPlayer.isKnockedDown;
                    remote.knockdownUntil = serverPlayer.knockdownUntil;
                    remote.isReadyToFly = serverPlayer.isReadyToFly;
                    remote.isBucketHead = serverPlayer.isBucketHead;
                    remote.isFrozenInIce = serverPlayer.isFrozenInIce;
                    remote.heldItem = serverPlayer.heldItem;
                    remote.speedMultiplier = serverPlayer.speedMultiplier;
                    remote.bossLives = serverPlayer.bossLives !== undefined ? serverPlayer.bossLives : 2;
                    remote.isDeadInBoss = serverPlayer.isDeadInBoss || false;
                }
            }
        }
    }

    // Interpolate remote players towards target positions (Ping-based Smoothing)
    updateRemotePlayers() {
        const lerpFactor = 0.25; // Smooth frame-by-frame Linear Interpolation (Lerp)
        for (let remote of this.remotePlayers.values()) {
            if (remote.is_finished || remote.isFrozenInIce) {
                remote.x = remote.targetX;
                remote.y = remote.targetY;
                remote.velocityY = 0;
            } else if (remote.isKnockedDown) {
                if (remote.knockdownPhase === "falling") {
                    remote.x += remote.knockdownVx || 0;
                    remote.knockdownVx = (remote.knockdownVx || 0) * 0.88;
                    remote.velocityY = (remote.velocityY || 0) + this.gravity * 1.4;
                    remote.y += remote.velocityY;
                    const targetGroundY = this.groundY - this.birdHeight;
                    if (remote.y >= targetGroundY) {
                        remote.y = targetGroundY;
                        if ((remote.knockdownBounceCount || 0) === 0 && Math.abs(remote.velocityY) > 2.0) {
                            remote.velocityY = -1.8;
                            remote.knockdownBounceCount = 1;
                            if (typeof window !== "undefined" && typeof window.onGroundImpact === "function") {
                                window.onGroundImpact(remote.x, targetGroundY, false);
                            }
                        } else {
                            remote.velocityY = 0;
                            remote.knockdownVx = 0;
                            remote.knockdownPhase = "grounded";
                            if (typeof window !== "undefined" && typeof window.onGroundImpact === "function") {
                                window.onGroundImpact(remote.x, targetGroundY, false);
                            }
                        }
                    }
                } else {
                    remote.y = this.groundY - this.birdHeight;
                    remote.velocityY = 0;
                    remote.x = remote.targetX;
                }
            } else {
                // Detect remote flap (jump impulse)
                if (remote.targetVelocityY <= -4.5 && (remote.lastVy === undefined || remote.lastVy > -3.0)) {
                    if (typeof window !== "undefined" && typeof window.onPlayerFlap === "function") {
                        window.onPlayerFlap(remote.x, remote.y, remote.skin_ID || 0, false);
                    }
                }
                remote.lastVy = remote.targetVelocityY;

                // Smooth frame-by-frame Lerp towards target server coordinates
                remote.x += (remote.targetX - remote.x) * lerpFactor;
                remote.y += (remote.targetY - remote.y) * lerpFactor;
                remote.velocityY += (remote.targetVelocityY - remote.velocityY) * lerpFactor;

                // Dead-reckon target forward position to absorb ping latency variations
                const speedMult = (remote.speedMultiplier !== undefined && remote.speedMultiplier !== null) ? remote.speedMultiplier : 1.0;
                remote.targetX += (this.forwardVelocity * speedMult) * 0.05;
            }
        }
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = PhysicsEngine;
}
