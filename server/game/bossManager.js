const { BIRD_WIDTH, BIRD_HEIGHT, GROUND_Y, JUMP_VELOCITY } = require("../config/constants");

const BOSS_CONFIGS = {
    1: {
        index: 1,
        name: "Ignis the Fire Dragon",
        themeId: "volcano",
        baseHp: 100,
        color: "#ff4757",
        accentColor: "#ffa502",
        attackInterval: 2400
    },
    2: {
        index: 2,
        name: "Glacius the Frost Yeti",
        themeId: "snowy",
        baseHp: 150,
        color: "#00d2d3",
        accentColor: "#54a0ff",
        attackInterval: 2200
    },
    3: {
        index: 3,
        name: "Shai-Khar the Dune Sandworm",
        themeId: "desert",
        baseHp: 200,
        color: "#e67e22",
        accentColor: "#f39c12",
        attackInterval: 2000
    },
    4: {
        index: 4,
        name: "Grizelda the Candy Witch",
        themeId: "candyland",
        baseHp: 180,
        color: "#fd79a8",
        accentColor: "#e84393",
        attackInterval: 2100
    },
    5: {
        index: 5,
        name: "Leviathan the Abyssal Terror",
        themeId: "new_underwater_map",
        baseHp: 220,
        color: "#1dd1a1",
        accentColor: "#10ac84",
        attackInterval: 1900
    }
};

class BossManager {
    constructor(lobby, gameEngine) {
        this.lobby = lobby;
        this.gameEngine = gameEngine;

        this.bossIndex = 1;
        this.status = "spawning"; // "fighting", "intermission", "victory_run", "completed", "wipeout"

        // Boss Physical Position on right edge of landscape arena (width 1140)
        // Positioned at right side to give comfortable distance from birds (Birds X=90..235 on left)
        this.baseX = 960;
        this.baseY = 260;
        this.x = this.baseX;
        this.y = this.baseY;
        this.width = 72;
        this.height = 110;
        this.floatTimeX = 0;
        this.floatTimeY = 0;
        this.hitFlashUntil = 0;

        // Health & Scaling
        this.maxHp = 100;
        this.hp = 100;
        const pCount = (this.lobby && this.lobby.players) ? (this.lobby.players.size || (Array.isArray(this.lobby.players) ? this.lobby.players.length : 1)) : 1;
        this.playerCount = Math.max(1, pCount);

        // Projectiles & Energy Orbs
        this.projectiles = [];
        this.energyOrbs = [];
        this.activeBeams = [];
        this.projectileCounter = 0;
        this.orbCounter = 0;

        // Timers
        this.lastAttackTime = Date.now() + 1500;
        this.lastOrbTime = Date.now() + 800;
        this.attackPatternIndex = 0;
        this.intermissionEnd = null;

        // Damage tracking per player
        this.playerDamage = new Map();

        this.initBoss(1);
    }

    initBoss(bossIndex) {
        this.bossIndex = bossIndex;
        this.bossConfig = BOSS_CONFIGS[bossIndex] || BOSS_CONFIGS[1];

        const pCount = (this.lobby && this.lobby.players) ? (this.lobby.players.size || (Array.isArray(this.lobby.players) ? this.lobby.players.length : 1)) : 1;
        this.playerCount = Math.max(1, pCount);
        this.maxHp = this.bossConfig.baseHp * this.playerCount;
        this.hp = this.maxHp;

        this.projectiles = [];
        this.energyOrbs = [];
        this.activeBeams = [];

        this.status = "fighting";
        this.lastAttackTime = Date.now() + 1800;
        this.lastOrbTime = Date.now() + 1000;
        this.attackPatternIndex = 0;

        // Reset movement waves on new boss
        this.floatTimeX = 0;
        this.floatTimeY = 0;

        // Update map theme on lobby
        if (this.lobby.maps && this.lobby.maps[0]) {
            this.lobby.maps[0].theme_id = this.bossConfig.themeId;
        }

        this.gameEngine.broadcast("boss_spawned", {
            bossIndex: this.bossIndex,
            bossName: this.bossConfig.name,
            name: this.bossConfig.name,
            themeId: this.bossConfig.themeId,
            hp: this.hp,
            maxHp: this.maxHp
        });
    }

    update(now) {
        if (this.status === "intermission") {
            this.updateIntermission(now);
            return;
        }

        if (this.status !== "fighting") return;

        // 1. Boss Dynamic 2D Motion (In-Out X and Up-Down Y)
        // Alternating wave frequencies to produce smooth natural figure-8/elliptical drifting
        this.floatTimeX += 0.024;
        this.floatTimeY += 0.038;

        // Horizontal in-out oscillation (near right edge of screen)
        // Center screen of landscape arena (1140) is X=570. Boss strictly NEVER crosses left of center screen!
        const oscX = Math.sin(this.floatTimeX) * 45; // -45 to +45
        const rawX = this.baseX + oscX; // 915 to 1005
        // Absolute clamp: keep at least 80px buffer right of center screen (min X=650),
        // and right edge must stay comfortably within right border (max X=1000, 1000 + 72 = 1072)
        this.x = Math.max(650, Math.min(1000, rawX));

        // Up-down vertical oscillation
        const oscY = Math.cos(this.floatTimeY) * 55; // -55 to +55
        const rawY = this.baseY + oscY;
        this.y = Math.max(140, Math.min(410, rawY));

        // 2. Spawn Attacks
        if (now >= this.lastAttackTime) {
            this.spawnBossAttack(now);
            this.lastAttackTime = now + (this.bossConfig.attackInterval || 2200);
        }

        // 3. Spawn Energy Orbs
        if (now >= this.lastOrbTime) {
            this.spawnEnergyOrb();
            this.lastOrbTime = now + 2800 + Math.random() * 1000;
        }

        // 4. Update Projectiles
        this.updateProjectiles();

        // 5. Update Energy Orbs
        this.updateEnergyOrbs();

        // 6. Update Beams
        this.updateBeams(now);

        // 7. Check Player Collisions (with Projectiles, Beams, Orbs)
        for (let player of this.lobby.players.values()) {
            this.checkEnergyOrbCollection(player);
            this.checkPlayerHazardHits(player, now);
        }
    }

    spawnBossAttack(now) {
        const pattern = this.attackPatternIndex % 3;
        this.attackPatternIndex++;

        const startX = this.x - 20;
        const startY = this.y + 35;

        if (this.bossIndex === 1) {
            // ================= BOSS 1: IGNIS (FIRE WYRM) =================
            if (pattern === 0) {
                // Fireball: Linear projectile towards player corridor
                const targetY = 160 + Math.random() * 320;
                const vy = (targetY - startY) * 0.010;
                this.addProjectile({
                    type: "fireball",
                    x: startX,
                    y: startY,
                    vx: -6.5,
                    vy: vy,
                    radius: 14,
                    color: "#ff4757"
                });
            } else if (pattern === 1) {
                // Triple Flame Spread
                [-1.8, 0, 1.8].forEach(vy => {
                    this.addProjectile({
                        type: "fireball",
                        x: startX,
                        y: startY,
                        vx: -6.0,
                        vy: vy,
                        radius: 12,
                        color: "#ffa502"
                    });
                });
            } else {
                // Magma Surge: 2 fast staggered fireballs
                this.addProjectile({
                    type: "magma",
                    x: startX,
                    y: 180 + Math.random() * 120,
                    vx: -7.5,
                    vy: 0,
                    radius: 16,
                    color: "#ff6348"
                });
                setTimeout(() => {
                    if (this.status === "fighting") {
                        this.addProjectile({
                            type: "magma",
                            x: startX,
                            y: 340 + Math.random() * 120,
                            vx: -7.5,
                            vy: 0,
                            radius: 16,
                            color: "#ff6348"
                        });
                    }
                }, 350);
            }
        } else if (this.bossIndex === 2) {
            // ================= BOSS 2: GLACIUS (FROST TITAN) =================
            if (pattern === 0) {
                // Ice Shard Rapid Burst
                for (let i = 0; i < 3; i++) {
                    setTimeout(() => {
                        if (this.status === "fighting") {
                            this.addProjectile({
                                type: "ice_shard",
                                x: startX,
                                y: startY + (i - 1) * 25,
                                vx: -8.0,
                                vy: 0,
                                radius: 10,
                                color: "#00d2d3"
                            });
                        }
                    }, i * 200);
                }
            } else if (pattern === 1) {
                // Frost Laser Beam with 1.2s warning telegraph
                const beamY = 180 + Math.random() * 260;
                this.addBeam(beamY, 60, now, 1200, 900);
            } else {
                // Floating Ice Mines with wavy trajectory
                this.addProjectile({
                    type: "ice_mine",
                    x: startX,
                    y: 200,
                    vx: -4.8,
                    vy: 0,
                    waveAmp: 2.2,
                    waveFreq: 0.08,
                    radius: 15,
                    color: "#54a0ff"
                });
                this.addProjectile({
                    type: "ice_mine",
                    x: startX,
                    y: 400,
                    vx: -4.8,
                    vy: 0,
                    waveAmp: -2.2,
                    waveFreq: 0.08,
                    radius: 15,
                    color: "#54a0ff"
                });
            }
        } else if (this.bossIndex === 3) {
            // ================= BOSS 3: SHAI-KHAR (DUNE SANDWORM) =================
            if (pattern === 0) {
                // Dual Solar Sand Beams: Top and Bottom beams leaving middle dodge lane
                this.addBeam(120, 70, now, 1200, 800);
                this.addBeam(480, 70, now, 1200, 800);
            } else if (pattern === 1) {
                // Swirling Sandstorm Orbs
                [-2.0, 0, 2.0].forEach((vy, idx) => {
                    this.addProjectile({
                        type: "sand_orb",
                        x: startX,
                        y: startY + (idx - 1) * 35,
                        vx: -6.5,
                        vy: vy,
                        radius: 16,
                        color: "#e67e22"
                    });
                });
            } else {
                // Desert Sand Spike Barrage
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        if (this.status === "fighting") {
                            this.addProjectile({
                                type: "sand_spike",
                                x: startX,
                                y: 150 + (i * 90) % 360,
                                vx: -7.5,
                                vy: (Math.random() - 0.5) * 1.5,
                                radius: 13,
                                color: "#f39c12"
                            });
                        }
                    }, i * 180);
                }
            }
        } else if (this.bossIndex === 4) {
            // ================= BOSS 4: GRIZELDA (CANDY WITCH) =================
            if (pattern === 0) {
                // Sweet Lollipop Rainbow Beam
                this.addBeam(160 + Math.random() * 260, 65, now, 1200, 850);
            } else if (pattern === 1) {
                // Sparkling Candy Magic Orbs
                [-1.8, 0, 1.8].forEach(vy => {
                    this.addProjectile({
                        type: "candy_magic",
                        x: startX,
                        y: startY,
                        vx: -6.2,
                        vy: vy,
                        radius: 14,
                        color: "#fd79a8"
                    });
                });
            } else {
                // Sugary Swirl Mines
                this.addProjectile({
                    type: "candy_magic",
                    x: startX,
                    y: 180,
                    vx: -4.6,
                    vy: 0,
                    waveAmp: 2.0,
                    waveFreq: 0.07,
                    radius: 15,
                    color: "#e84393"
                });
                this.addProjectile({
                    type: "candy_magic",
                    x: startX,
                    y: 380,
                    vx: -4.6,
                    vy: 0,
                    waveAmp: -2.0,
                    waveFreq: 0.07,
                    radius: 15,
                    color: "#e84393"
                });
            }
        } else if (this.bossIndex === 5) {
            // ================= BOSS 5: LEVIATHAN (ABYSSAL TERROR) =================
            if (pattern === 0) {
                // Dual Hydro Torrent Beams
                this.addBeam(140, 65, now, 1100, 800);
                this.addBeam(450, 65, now, 1100, 800);
            } else if (pattern === 1) {
                // Abyssal Depth Bubbles Spread
                [-2.2, -0.8, 0.8, 2.2].forEach(vy => {
                    this.addProjectile({
                        type: "water_bubble",
                        x: startX,
                        y: startY,
                        vx: -6.8,
                        vy: vy,
                        radius: 15,
                        color: "#1dd1a1"
                    });
                });
            } else {
                // Tidal Surge Barrage
                for (let i = 0; i < 4; i++) {
                    setTimeout(() => {
                        if (this.status === "fighting") {
                            this.addProjectile({
                                type: "water_bubble",
                                x: startX,
                                y: 140 + (i * 95) % 360,
                                vx: -8.0,
                                vy: (Math.random() - 0.5) * 1.8,
                                radius: 14,
                                color: "#10ac84"
                            });
                        }
                    }, i * 160);
                }
            }
        }
    }

    addProjectile(p) {
        this.projectileCounter++;
        p.id = "proj_" + this.projectileCounter;
        p.spawnTime = Date.now();
        this.projectiles.push(p);
    }

    addBeam(y, height, now, warningDurationMs = 1200, fireDurationMs = 800) {
        const id = "beam_" + Date.now() + "_" + Math.floor(Math.random() * 100);
        this.activeBeams.push({
            id,
            y,
            height,
            warningUntil: now + warningDurationMs,
            fireUntil: now + warningDurationMs + fireDurationMs,
            isWarning: true,
            isFiring: false
        });
    }

    spawnEnergyOrb() {
        this.orbCounter++;
        const orb = {
            id: "orb_" + this.orbCounter,
            x: 780 + Math.random() * 80,
            y: 140 + Math.random() * 340,
            vx: -2.5,
            radius: 14,
            collected: false
        };
        this.energyOrbs.push(orb);
    }

    updateProjectiles() {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.x += p.vx;
            p.y += p.vy;

            if (p.waveAmp) {
                p.y += Math.sin((Date.now() - p.spawnTime) * p.waveFreq) * p.waveAmp;
            }

            // Remove if off screen
            if (p.x < -60 || p.y < -40 || p.y > 640) {
                this.projectiles.splice(i, 1);
            }
        }
    }

    updateEnergyOrbs() {
        for (let i = this.energyOrbs.length - 1; i >= 0; i--) {
            const orb = this.energyOrbs[i];
            orb.x += orb.vx;

            // Remove if off screen or collected
            if (orb.collected || orb.x < 50) {
                this.energyOrbs.splice(i, 1);
            }
        }
    }

    updateBeams(now) {
        for (let i = this.activeBeams.length - 1; i >= 0; i--) {
            const b = this.activeBeams[i];
            if (now < b.warningUntil) {
                b.isWarning = true;
                b.isFiring = false;
            } else if (now < b.fireUntil) {
                b.isWarning = false;
                b.isFiring = true;
            } else {
                this.activeBeams.splice(i, 1);
            }
        }
    }

    checkEnergyOrbCollection(player) {
        if (!player || player.isKnockedDown || player.isDeadInBoss || !player.is_alive) return;

        const pBox = { x: player.x, y: player.y, width: BIRD_WIDTH, height: BIRD_HEIGHT };

        for (let orb of this.energyOrbs) {
            if (orb.collected) continue;

            const orbBox = {
                x: orb.x - orb.radius,
                y: orb.y - orb.radius,
                width: orb.radius * 2,
                height: orb.radius * 2
            };

            if (this.rectIntersect(pBox, orbBox)) {
                orb.collected = true;

                // Deal 25 Damage to Boss
                const damage = 25;
                this.hp = Math.max(0, this.hp - damage);
                this.hitFlashUntil = Date.now() + 220;

                const curDmg = this.playerDamage.get(player.player_id) || 0;
                this.playerDamage.set(player.player_id, curDmg + damage);

                this.gameEngine.broadcast("boss_damaged", {
                    bossIndex: this.bossIndex,
                    hp: this.hp,
                    bossHp: this.hp,
                    maxHp: this.maxHp,
                    damage,
                    attackerId: player.player_id,
                    attackerName: player.name,
                    collectorId: player.player_id,
                    collectorName: player.name,
                    orbId: orb.id
                });

                if (this.hp <= 0) {
                    this.onBossDefeated();
                    break;
                }
            }
        }
        this.energyOrbs = this.energyOrbs.filter(o => !o.collected);
    }

    checkPlayerHazardHits(player, now) {
        if (!player || player.isInvincible || player.isKnockedDown || player.isDeadInBoss || !player.is_alive) return;

        const pBox = { x: player.x, y: player.y, width: BIRD_WIDTH, height: BIRD_HEIGHT };

        // 1. Check Projectile Hits
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            const pCircBox = {
                x: p.x - p.radius,
                y: p.y - p.radius,
                width: p.radius * 2,
                height: p.radius * 2
            };

            if (this.rectIntersect(pBox, pCircBox)) {
                this.projectiles.splice(i, 1);
                this.damagePlayer(player, now);
                return;
            }
        }

        // 2. Check Active Beam Hits
        for (let b of this.activeBeams) {
            if (!b.isFiring) continue;

            const beamBox = {
                x: 0,
                y: b.y - b.height / 2,
                width: 2500,
                height: b.height
            };

            if (this.rectIntersect(pBox, beamBox)) {
                this.damagePlayer(player, now);
                return;
            }
        }
    }

    damagePlayer(player, now) {
        // Shield Protection
        if (player.hasShield) {
            player.hasShield = false;
            player.isInvincible = true;
            player.invincibleUntil = now + 3000;
            this.gameEngine.broadcast("player_shield_break", {
                playerId: player.player_id,
                x: player.x,
                y: player.y
            });
            return;
        }

        player.bossLives = Math.max(0, (player.bossLives !== undefined ? player.bossLives : 2) - 1);

        if (player.bossLives > 0) {
            // Knockdown 5s: falls down to ground, can flap after 5s to recover with 4s shield
            player.isKnockedDown = true;
            player.knockdownUntil = now + 5000;
            player.isReadyToFly = false;
            player.y = GROUND_Y - BIRD_HEIGHT;
            player.velocityY = 0;

            this.gameEngine.broadcast("player_knocked_down", {
                playerId: player.player_id,
                x: player.x,
                y: player.y,
                knockdownDurationMs: 5000,
                bossLives: player.bossLives
            });
        } else {
            // Player lost both lives: Game Over for this boss! Stays down until teammates defeat boss
            player.bossLives = 0;
            player.isDeadInBoss = true;
            player.isKnockedDown = true;
            player.knockdownUntil = null; // Cannot self-recover
            player.y = GROUND_Y - BIRD_HEIGHT;
            player.velocityY = 0;

            this.gameEngine.broadcast("player_boss_death", {
                playerId: player.player_id,
                playerName: player.name,
                bossLives: 0
            });

            // Check if all players are dead -> Team Wipeout!
            const alivePlayers = Array.from(this.lobby.players.values()).filter(p => !p.isDeadInBoss);
            if (alivePlayers.length === 0) {
                this.status = "wipeout";
                this.gameEngine.broadcast("boss_team_wipe", {
                    bossIndex: this.bossIndex,
                    bossName: this.bossConfig.name
                });

                setTimeout(() => {
                    this.gameEngine.endMatch(false);
                }, 2500);
            }
        }
    }

    onBossDefeated() {
        this.status = "intermission";
        this.projectiles = [];
        this.energyOrbs = [];
        this.activeBeams = [];

        const isFinalBoss = (this.bossIndex >= 3);
        this.gameEngine.broadcast("boss_defeated", {
            bossIndex: this.bossIndex,
            bossName: this.bossConfig.name,
            nextBossIndex: this.bossIndex + 1,
            isFinalBoss
        });

        if (isFinalBoss) {
            this.startVictoryRun();
            return;
        }

        // Revive ALL players with 2 full lives and 4.5s invincibility
        const now = Date.now();
        for (let player of this.lobby.players.values()) {
            player.bossLives = 2;
            player.isDeadInBoss = false;
            player.isKnockedDown = false;
            player.isReadyToFly = false;
            player.knockdownUntil = null;
            player.y = 300;
            player.velocityY = -2.5;
            player.isInvincible = true;
            player.invincibleUntil = now + 4500;
        }

        this.gameEngine.broadcast("boss_players_revived", {
            message: "All teammates revived! Prepare for next boss!"
        });

        // 5-second rest period
        this.intermissionEnd = now + 5000;
        this.gameEngine.broadcast("boss_intermission", {
            secondsRemaining: 5,
            nextBossIndex: this.bossIndex + 1
        });
    }

    updateIntermission(now) {
        if (!this.intermissionEnd) return;

        const currentTime = (now !== undefined && now !== null) ? now : Date.now();
        const remainingMs = this.intermissionEnd - currentTime;
        if (remainingMs <= 0) {
            this.intermissionEnd = null;

            if (this.bossIndex < 3) {
                // Advance to next boss
                this.initBoss(this.bossIndex + 1);
            } else {
                // ALL 3 BOSSES DEFEATED! Trigger Stage Conclusion
                this.startVictoryRun();
            }
        }
    }

    startVictoryRun() {
        this.status = "victory_run";
        this.projectiles = [];
        this.energyOrbs = [];
        this.activeBeams = [];

        // Revive ALL players so everyone participates in the victory run together
        const now = Date.now();
        for (let player of this.lobby.players.values()) {
            player.bossLives = 2;
            player.isDeadInBoss = false;
            player.isKnockedDown = false;
            player.isReadyToFly = false;
            player.knockdownUntil = null;
            player.isInvincible = true;
            player.invincibleUntil = now + 20000;
        }

        // Lift fixed position and place the REAL Finish Line far back in the stage
        this.lobby.finishLineX = 2400;

        // Broadcast Victory Run: Birds fly into the Finish Line!
        this.gameEngine.broadcast("boss_victory_run", {
            message: "ALL 3 BOSSES DEFEATED! FLY TO THE FINISH LINE!",
            finishLineX: this.lobby.finishLineX
        });

        // Generous safety fallback in case all players go completely AFK
        if (this.victoryRunTimer) clearTimeout(this.victoryRunTimer);
        this.victoryRunTimer = setTimeout(() => {
            if (this.status === "victory_run") {
                this.status = "completed";
                this.gameEngine.endMatch(true);
            }
        }, 20000);
    }

    getIntermissionRemaining() {
        if (this.status !== "intermission" || !this.intermissionEnd) return 0;
        return Math.max(0, Math.ceil((this.intermissionEnd - Date.now()) / 1000));
    }

    getState() {
        return {
            bossIndex: this.bossIndex,
            name: (this.bossConfig && this.bossConfig.name) || "Boss",
            themeId: (this.bossConfig && this.bossConfig.themeId) || "volcano",
            status: this.status,
            x: Math.round(this.x),
            y: Math.round(this.y),
            width: this.width,
            height: this.height,
            hp: this.hp,
            maxHp: this.maxHp,
            color: (this.bossConfig && this.bossConfig.color) || "#ff4757",
            accentColor: (this.bossConfig && this.bossConfig.accentColor) || "#ffa502",
            hitFlash: Date.now() < this.hitFlashUntil,
            intermissionRemaining: this.getIntermissionRemaining(),
            projectiles: this.projectiles.map(p => ({
                id: p.id,
                type: p.type,
                x: Math.round(p.x),
                y: Math.round(p.y),
                radius: p.radius,
                color: p.color
            })),
            energyOrbs: this.energyOrbs.map(o => ({
                id: o.id,
                x: Math.round(o.x),
                y: Math.round(o.y),
                radius: o.radius
            })),
            beams: this.activeBeams.map(b => ({
                id: b.id,
                y: Math.round(b.y),
                height: b.height,
                isWarning: b.isWarning,
                isFiring: b.isFiring
            }))
        };
    }

    rectIntersect(r1, r2) {
        return !(
            r2.x > r1.x + r1.width ||
            r2.x + r2.width < r1.x ||
            r2.y > r1.y + r1.height ||
            r2.y + r2.height < r1.y
        );
    }
}

module.exports = BossManager;
