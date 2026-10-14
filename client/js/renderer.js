class CanvasRenderer {
    constructor(canvas, physicsEngine) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.physics = physicsEngine;

        this.width = canvas.width;
        this.height = canvas.height;

        // Config & Assets
        this.assetsConfig = null;
        this.themeImages = {}; // theme_id -> { bg: Image, topPipe: Image, bottomPipe: Image }
        this.hatImages = {};   // hat_id -> Image
        this.images = {};

        // Parallax & Transition State
        this.currentThemeId = "classic_day";
        this.targetThemeId = "classic_day";
        this.fadeAlpha = 1.0;
        this.isFading = false;

        this.loadAssetsConfig();

        this.maps = [];
        this.checkpoints = [];
        this.itemBoxes = [];
        this.finishLineX = 0;
        this.modeId = "flappy_race";
        this.bossState = null;

        this.cameraX = 0;
        this.targetFps = 60;
        this.fpsLocked = false;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.currentFps = 60;

        this.animFrame = 0;
        setInterval(() => {
            this.animFrame = (this.animFrame + 1) % 4;
        }, 120);

        // Visual Effects, Death Animations & Particle Systems
        this.particles = [];
        this.afterimages = [];
        this.teleportRings = [];
        this.floatingTexts = [];
        this.deathEntities = [];
        this.screenFlashes = [];
        this.screenShakeTimer = 0;
        this.screenShakeIntensity = 0;
        this.isShaking = false;
        this.hitPauseUntil = 0; // Micro freeze-frame timer for arcade impact weight
    }

    resize(width, height) {
        if (this.width === width && this.height === height && this.canvas.width === width && this.canvas.height === height) {
            return;
        }
        this.canvas.width = width;
        this.canvas.height = height;
        this.width = width;
        this.height = height;
        if (this.ctx) {
            this.ctx.imageSmoothingEnabled = false;
        }
    }

    drawFallbackPngBox(x, y, width, height, text = "PNG") {
        this.ctx.save();
        this.ctx.fillStyle = "#ffffff";
        this.ctx.fillRect(x, y, width, height);
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(x, y, width, height);
        this.ctx.fillStyle = "#000000";
        this.ctx.font = "7px 'Press Start 2P'";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(text, x + width / 2, y + height / 2);
        this.ctx.restore();
    }

    async loadAssetsConfig() {
        const sources = {
            bird0: "assets/images/flappybird0.png",
            bird1: "assets/images/flappybird1.png",
            bird2: "assets/images/flappybird2.png",
            bird3: "assets/images/flappybird3.png",
            bg: "assets/images/flappybirdbg.png",
            topPipe: "assets/images/toppipe.png",
            bottomPipe: "assets/images/bottompipe.png",
            buble: "assets/images/buble.png",
            slowness: "assets/images/items/Slowness_JE4.png",
            bucket: "assets/images/items/bucket.png",
            absorption: "assets/images/items/Absorption_JE3_BE3.png",
            inbucket: "assets/images/items/inbucket.png",
            checkpointflag: "assets/images/checkpointflag.png",
            winflag: "assets/images/winflag.png",
            lucky_block: "assets/images/items/lucky_block.png",
            box: "assets/images/items/lucky_block.png",
            deathnote: "assets/images/items/DeathNote.webp",
            swap: "assets/images/items/swap.png",
            boss1: "assets/images/bosses/boss1.png",
            boss2: "assets/images/bosses/boss2.png",
            boss3: "assets/images/bosses/boss3.png",
            boss4: "assets/images/bosses/boss4.png",
            boss5: "assets/images/bosses/boss5.png",
            dragon: "assets/images/bosses/boss1.png",
            yeti: "assets/images/bosses/boss2.png",
            duneboss: "assets/images/bosses/boss3.png",
            candyboss: "assets/images/bosses/boss4.png",
            waterboss: "assets/images/bosses/boss5.png"
        };

        for (let key in sources) {
            this.images[key] = new Image();
            this.images[key].src = sources[key];
        }

        try {
            const res = await fetch("config/assets.json");
            this.assetsConfig = await res.json();
            this.preloadConfiguredAssets();
        } catch (e) {
            console.warn("[Renderer] Failed to load config/assets.json, using fallback theme assets:", e);
        }
    }

    preloadConfiguredAssets() {
        if (!this.assetsConfig) return;

        if (this.assetsConfig.map_themes) {
            for (let theme of this.assetsConfig.map_themes) {
                const bgImg = new Image();
                bgImg.src = theme.bg_src;

                const topImg = new Image();
                topImg.src = theme.pipe_top_src || theme.pipe_src;

                const botImg = new Image();
                botImg.src = theme.pipe_bottom_src || theme.pipe_src;

                this.themeImages[theme.theme_id] = {
                    bg: bgImg,
                    topPipe: topImg,
                    bottomPipe: botImg
                };
            }
        }

        // Fallback for new_underwater_map theme
        if (!this.themeImages["new_underwater_map"]) {
            const uwBg = new Image();
            uwBg.src = "assets/images/backgrounds/new_underwater_map.png";
            const topImg = new Image();
            topImg.src = "assets/images/pipes/toppipe_underwater.png";
            const botImg = new Image();
            botImg.src = "assets/images/pipes/bottompipe_underwater.png";
            this.themeImages["new_underwater_map"] = { bg: uwBg, topPipe: topImg, bottomPipe: botImg };
        }

        if (this.assetsConfig.hats) {
            for (let hat of this.assetsConfig.hats) {
                if (hat.src) {
                    const hatImg = new Image();
                    hatImg.src = hat.src;
                    this.hatImages[hat.id] = hatImg;
                }
            }
        }

        this.itemImages = {};
        if (this.assetsConfig.items) {
            for (let key in this.assetsConfig.items) {
                const itemImg = new Image();
                itemImg.src = this.assetsConfig.items[key];
                this.itemImages[key] = itemImg;
            }
        }

        if (!this.itemImages.buble) {
            this.itemImages.buble = this.images.buble;
        }

        if (!this.itemImages.inbucket) {
            this.itemImages.inbucket = this.images.inbucket;
        }

        if (!this.itemImages.box) {
            this.itemImages.box = this.images.box || this.images.lucky_block;
        }

        if (!this.itemImages.lucky_block) {
            this.itemImages.lucky_block = this.itemImages.box || this.images.lucky_block;
        }

        if (!this.itemImages.deathnote) {
            this.itemImages.deathnote = this.images.deathnote;
        }

        if (!this.itemImages.swap) {
            this.itemImages.swap = this.images.swap;
        }

        if (this.assetsConfig.bosses) {
            for (let boss of this.assetsConfig.bosses) {
                const bImg = new Image();
                bImg.src = boss.src;
                this.images["boss" + boss.index] = bImg;
                if (boss.id) this.images[boss.id] = bImg;
            }
        }
    }

    setGameData(maps, checkpoints, itemBoxes, finishLineX, modeId) {
        this.maps = maps || [];
        this.checkpoints = checkpoints || [];
        this.itemBoxes = itemBoxes || [];
        this.finishLineX = finishLineX || 0;
        this.modeId = modeId || "flappy_race";

        if (this.maps.length > 0 && this.maps[0].theme_id) {
            this.currentThemeId = this.maps[0].theme_id;
            this.targetThemeId = this.maps[0].theme_id;
            this.fadeAlpha = 1.0;
            this.isFading = false;
        }
    }

    setFpsLock(locked) {
        this.fpsLocked = locked;
    }

    applyScreenShake(isHitPaused = false) {
        if (this.screenShakeTimer > Date.now() || isHitPaused) {
            const intensity = isHitPaused 
                ? Math.max(2, this.screenShakeIntensity * 0.5) 
                : this.screenShakeIntensity;
            const shakeX = (Math.random() - 0.5) * intensity * 2;
            const shakeY = (Math.random() - 0.5) * intensity * 2;
            this.ctx.save();
            this.ctx.translate(shakeX, shakeY);
            this.isShaking = true;
        } else {
            this.isShaking = false;
        }
    }

    restoreScreenShake() {
        if (this.isShaking) {
            this.ctx.restore();
            this.isShaking = false;
        }
    }

    triggerHitPause(durationMs = 45) {
        this.hitPauseUntil = performance.now() + durationMs;
    }

    triggerScreenShake(intensity = 6, durationMs = 220) {
        this.screenShakeIntensity = Math.min(8, intensity); // Balanced intensity
        this.screenShakeTimer = Date.now() + durationMs;
    }

    triggerScreenFlash(color = "rgba(231, 76, 60, 0.4)", durationMs = 300) {
        this.screenFlashes.push({
            color: color,
            until: Date.now() + durationMs,
            duration: durationMs
        });
    }

    getSkinFeatherColors(skinId) {
        const palettes = [
            ["#f1c40f", "#f39c12", "#ffeaa7", "#ffffff"], // 0: Classic Yellow
            ["#ff3838", "#c0392b", "#ff7675", "#ffffff"], // 1: Ruby Red
            ["#2ecc71", "#27ae60", "#55efc4", "#ffffff"], // 2: Emerald Green
            ["#3498db", "#2980b9", "#74b9ff", "#ffffff"], // 3: Ocean Blue
            ["#9b59b6", "#8e44ad", "#a29bfe", "#ffffff"]  // 4: Royal Purple
        ];
        return palettes[Number(skinId)] || palettes[0];
    }

    triggerFlapEffect(worldX, worldY, skinId = 0, isLocal = false) {
        const featherColors = this.getSkinFeatherColors(skinId);

        // 1. Fluttering feathers matching bird skin color
        const numFeathers = isLocal ? 4 : 2;
        for (let i = 0; i < numFeathers; i++) {
            const color = featherColors[Math.floor(Math.random() * featherColors.length)];
            this.particles.push({
                type: "feather",
                x: worldX + 8 + (Math.random() - 0.5) * 8,
                y: worldY + 12 + Math.random() * 8,
                vx: -1.5 - Math.random() * 2.0,
                vy: 0.3 + Math.random() * 1.5,
                size: 4 + Math.random() * 4,
                color: color,
                alpha: 0.9,
                decay: 0.026,
                gravity: 0.06,
                rotation: (Math.random() - 0.5) * Math.PI,
                vr: (Math.random() - 0.5) * 0.2,
                wobbleSpeed: 0.15 + Math.random() * 0.1,
                wobblePhase: Math.random() * Math.PI * 2
            });
        }

        // 2. Soft curved wind puff cloud
        this.particles.push({
            type: "wind_puff",
            x: worldX + 10,
            y: worldY + 18,
            vx: -0.9 - Math.random() * 1.0,
            vy: 0.8 + Math.random() * 0.8,
            radius: 4,
            maxRadius: 14 + Math.random() * 4,
            color: "rgba(255, 255, 255, 0.75)",
            alpha: 0.7,
            decay: 0.045
        });
    }

    triggerDeathEffect(worldX, worldY, isLocal = false, labelText = "CRASH!") {
        if (isLocal) {
            this.triggerHitPause(50); // Micro Hit-Pause: 1-2 frames pause for arcade crunch
            this.triggerScreenShake(6, 220); // Balanced screen shake
            this.triggerScreenFlash("rgba(231, 76, 60, 0.4)", 300);
        } else if (labelText !== "DEATH NOTE!") {
            this.triggerScreenShake(3, 140);
        }

        // 1. Expanding Impact Shockwave Ring
        this.teleportRings.push({
            x: worldX + 17,
            y: worldY + 12,
            radius: 6,
            maxRadius: 48,
            color: "#e74c3c",
            alpha: 1.0,
            lineWidth: 3.5,
            decay: 0.04
        });

        // 2. Feather Explosion (skin matching)
        const localSkin = window.playerSkinId || 0;
        const featherColors = this.getSkinFeatherColors(isLocal ? localSkin : 0);
        for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20 + (Math.random() - 0.5);
            const speed = 2.5 + Math.random() * 5.5;
            this.particles.push({
                type: "feather",
                x: worldX + 17,
                y: worldY + 12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.2,
                size: 5 + Math.random() * 5,
                color: featherColors[i % featherColors.length],
                alpha: 1.0,
                decay: 0.024,
                gravity: 0.14,
                rotation: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * 0.35,
                wobbleSpeed: 0.15,
                wobblePhase: Math.random() * Math.PI * 2
            });
        }

        // 3. Upward Bouncing Death Entity
        this.deathEntities.push({
            x: worldX,
            y: worldY,
            vx: (Math.random() - 0.5) * 2,
            vy: -6,
            rotation: 0,
            vr: (Math.random() > 0.5 ? 1 : -1) * 0.35,
            alpha: 1.0,
            decay: 0.02,
            isLocal: isLocal
        });

        // 4. Floating Death Label Text
        this.floatingTexts.push({
            x: worldX,
            y: worldY - 15,
            vy: -1.2,
            text: labelText,
            color: "#e74c3c",
            alpha: 1.0,
            decay: 0.02
        });
    }

    triggerKnockdownEffect(worldX, worldY, isLocal = false) {
        if (isLocal) {
            this.triggerHitPause(50); // Micro Hit-Pause: 1-2 frames freeze on collision
            this.triggerScreenShake(6, 220); // Balanced screen shake
            this.triggerScreenFlash("rgba(231, 76, 60, 0.35)", 250);
        } else {
            this.triggerScreenShake(3, 140);
        }

        // 1. Collision Shockwave Ring
        this.teleportRings.push({
            x: worldX + 17,
            y: worldY + 12,
            radius: 6,
            maxRadius: 50,
            color: "#ffdd59",
            alpha: 1.0,
            lineWidth: 3.5,
            decay: 0.04
        });

        // 2. Feather Explosion (skin matching)
        const localSkin = window.playerSkinId || 0;
        const featherColors = this.getSkinFeatherColors(isLocal ? localSkin : 0);
        for (let i = 0; i < 18; i++) {
            const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5);
            const speed = 2.5 + Math.random() * 5.0;
            this.particles.push({
                type: "feather",
                x: worldX + 17,
                y: worldY + 12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.2,
                size: 5 + Math.random() * 5,
                color: featherColors[i % featherColors.length],
                alpha: 1.0,
                decay: 0.024 + Math.random() * 0.015,
                gravity: 0.12,
                rotation: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * 0.3,
                wobbleSpeed: 0.15,
                wobblePhase: Math.random() * Math.PI * 2
            });
        }

        // 3. Impact Sparks
        const sparkColors = ["#ffffff", "#f1c40f", "#e67e22", "#e74c3c"];
        for (let i = 0; i < 14; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 4;
            this.particles.push({
                type: "rainbow_sparkle",
                x: worldX + 17,
                y: worldY + 12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.0,
                size: 3 + Math.random() * 3,
                color: sparkColors[i % sparkColors.length],
                alpha: 1.0,
                decay: 0.04,
                rotation: Math.random() * Math.PI,
                vr: 0.2
            });
        }

        // 4. Floating Knockdown Label
        this.floatingTexts.push({
            x: worldX + 17,
            y: worldY - 14,
            vy: -1.2,
            text: "KNOCKED DOWN!",
            color: "#e74c3c",
            alpha: 1.0,
            decay: 0.02
        });
    }

    triggerGroundImpact(worldX, worldY, isLocal = false) {
        // Comic dust puff & impact sparkles upon slamming on ground
        const impactColors = ["#ffffff", "#ecf0f1", "#bdc3c7", "#f1c40f", "#f39c12"];
        for (let i = 0; i < 14; i++) {
            const dir = (i % 2 === 0) ? 1 : -1;
            const spread = Math.random() * 0.6 + 0.4;
            const speed = (2 + Math.random() * 4) * spread;
            this.particles.push({
                type: "wind_puff",
                x: worldX + 17,
                y: worldY + 18,
                vx: dir * speed,
                vy: -0.8 - Math.random() * 1.8,
                radius: 3,
                maxRadius: 12 + Math.random() * 4,
                color: impactColors[Math.floor(Math.random() * impactColors.length)],
                alpha: 0.85,
                decay: 0.045
            });
        }
        if (isLocal) {
            this.triggerScreenShake(4, 180); // Balanced screen shake
        }
    }

    triggerShieldBreakEffect(worldX, worldY) {
        // 1. Water Ripple Ring
        this.teleportRings.push({
            x: worldX + 17,
            y: worldY + 12,
            radius: 8,
            maxRadius: 44,
            color: "#00d2d3",
            alpha: 1.0,
            lineWidth: 3.5,
            decay: 0.045
        });

        // 2. Water Splash Burst Droplets
        const splashColors = ["#00d2d3", "#54a0ff", "#48dbfb", "#c7ecee", "#ffffff"];
        for (let i = 0; i < 22; i++) {
            const angle = (Math.PI * 2 * i) / 22 + (Math.random() - 0.5) * 0.4;
            const speed = 2.2 + Math.random() * 4.8;
            this.particles.push({
                type: "water_drop",
                x: worldX + 17,
                y: worldY + 12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.2,
                size: 2.5 + Math.random() * 3.5,
                color: splashColors[Math.floor(Math.random() * splashColors.length)],
                alpha: 0.95,
                decay: 0.035,
                gravity: 0.22,
                rotation: angle,
                vr: 0.1
            });
        }

        // 3. Floating "BLOCKED!" Text
        this.floatingTexts.push({
            x: worldX + 17,
            y: worldY - 16,
            vy: -1.4,
            text: "BLOCKED! 🛡️",
            color: "#48dbfb",
            alpha: 1.0,
            decay: 0.022
        });
    }

    triggerIceShatterEffect(worldX, worldY) {
        // 1. Frost Shockwave Ring
        this.teleportRings.push({
            x: worldX + 17,
            y: worldY + 12,
            radius: 8,
            maxRadius: 44,
            color: "#70c5ce",
            alpha: 1.0,
            lineWidth: 4,
            decay: 0.04
        });

        // 2. Ice Crystal Shards Burst
        const iceColors = ["#70c5ce", "#a0e7e5", "#dff9fb", "#ffffff"];
        for (let i = 0; i < 20; i++) {
            const angle = (Math.PI * 2 * i) / 20 + (Math.random() - 0.5) * 0.3;
            const speed = 2.5 + Math.random() * 5.0;
            this.particles.push({
                type: "ice_shard",
                x: worldX + 17,
                y: worldY + 12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.5,
                size: 4 + Math.random() * 6,
                color: iceColors[Math.floor(Math.random() * iceColors.length)],
                alpha: 1.0,
                decay: 0.028,
                gravity: 0.24,
                rotation: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * 0.35
            });
        }

        // 3. Floating "SHATTER!" Text
        this.floatingTexts.push({
            x: worldX + 17,
            y: worldY - 16,
            vy: -1.4,
            text: "SHATTER! ❄️",
            color: "#70c5ce",
            alpha: 1.0,
            decay: 0.022
        });
    }

    triggerItemBoxCollectEffect(boxX, boxY, itemName = "ITEM", isLocal = false) {
        // 1. Golden Shockwave Ring
        this.teleportRings.push({
            x: boxX + 16,
            y: boxY + 16,
            radius: 6,
            maxRadius: 42,
            color: "#f1c40f",
            alpha: 1.0,
            lineWidth: 3.5,
            decay: 0.045
        });

        // 2. Golden Shimmer Sparkles Burst
        const goldColors = ["#f1c40f", "#f39c12", "#ffd32a", "#fff200", "#ffffff"];
        for (let i = 0; i < 18; i++) {
            const angle = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5);
            const speed = 2 + Math.random() * 4.5;
            this.particles.push({
                type: "rainbow_sparkle",
                x: boxX + 16,
                y: boxY + 16,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.0,
                size: 3.5 + Math.random() * 4,
                color: goldColors[Math.floor(Math.random() * goldColors.length)],
                alpha: 1.0,
                decay: 0.035,
                rotation: Math.random() * Math.PI,
                vr: 0.2
            });
        }

        // 3. Floating Item Name Popup
        const formattedName = itemName ? itemName.toUpperCase() : "ITEM";
        this.floatingTexts.push({
            x: boxX + 16,
            y: boxY - 10,
            vy: -1.5,
            text: `+ ${formattedName}!`,
            color: "#f1c40f",
            alpha: 1.0,
            decay: 0.02
        });
    }

    triggerSwapEffect(x1, y1, x2, y2, p1Name = "", p2Name = "") {
        // 1. Purple Magic Screen Flash & Balanced Shake
        this.triggerScreenFlash("rgba(155, 89, 182, 0.4)", 380);
        this.triggerScreenShake(5, 200);

        // 2. Dimensional Beam connecting both swapped locations
        this.particles.push({
            type: "dimensional_beam",
            x1: x1 + 17,
            y1: y1 + 12,
            x2: x2 + 17,
            y2: y2 + 12,
            color: "#a29bfe",
            alpha: 1.0,
            decay: 0.04
        });

        const positions = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
        const magicColors = ["#9b59b6", "#8e44ad", "#3498db", "#00ffff", "#f1c40f", "#ffffff"];

        positions.forEach((pos) => {
            // Expanding Dimensional Shockwave Rings
            this.teleportRings.push({
                x: pos.x,
                y: pos.y,
                radius: 5,
                maxRadius: 48,
                color: "#9b59b6",
                alpha: 1.0,
                lineWidth: 4,
                decay: 0.03
            });
            this.teleportRings.push({
                x: pos.x,
                y: pos.y,
                radius: 2,
                maxRadius: 36,
                color: "#00ffff",
                alpha: 1.0,
                lineWidth: 2.5,
                decay: 0.04
            });

            // Magic Vortex Swirl Burst
            for (let i = 0; i < 24; i++) {
                const angle = (Math.PI * 2 * i) / 24;
                const speed = 2 + Math.random() * 5;
                this.particles.push({
                    type: "rainbow_sparkle",
                    x: pos.x,
                    y: pos.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 3 + Math.random() * 4,
                    color: magicColors[Math.floor(Math.random() * magicColors.length)],
                    alpha: 1.0,
                    decay: 0.025,
                    rotation: angle,
                    vr: 0.15
                });
            }

            // Floating "SWAPPED! ⇄" Text
            this.floatingTexts.push({
                x: pos.x,
                y: pos.y - 20,
                vy: -1.5,
                text: "SWAPPED! ⇄",
                color: "#f1c40f",
                alpha: 1.0,
                decay: 0.02
            });
        });
    }

    triggerDashEffect(worldX, worldY, skinId = 0, isLocal = false) {
        // 1. Screen micro-shake
        this.triggerScreenShake(3, 140);

        // 2. Trailing rapid afterimages
        for (let i = 0; i < 5; i++) {
            this.afterimages.push({
                x: worldX - i * 14,
                y: worldY,
                velocityY: -1.5,
                skinId: skinId,
                hatId: 0,
                isLocal: isLocal,
                alpha: 0.7 - i * 0.12,
                decay: 0.075,
                hue: isLocal ? 190 : 45
            });
        }

        // 3. Speed Lines (เส้นสปีดไลน์) trailing behind bird
        const streakColors = ["#00f2fe", "#4facfe", "#00ffff", "#ffffff", "#f1c40f"];
        for (let i = 0; i < 16; i++) {
            this.particles.push({
                type: "speed_streak",
                x: worldX + (Math.random() - 0.5) * 14,
                y: worldY + Math.random() * 26,
                length: 40 + Math.random() * 52,
                color: streakColors[Math.floor(Math.random() * streakColors.length)],
                vx: -13 - Math.random() * 8,
                alpha: 0.95,
                decay: 0.05
            });
        }

        // 4. Dash wind puff & shockwave ring
        this.teleportRings.push({
            x: worldX + 4,
            y: worldY + 12,
            radius: 4,
            maxRadius: 36,
            color: "#00f2fe",
            alpha: 0.9,
            lineWidth: 3,
            decay: 0.055
        });

        // 5. Floating "DASH! ⚡" text
        this.floatingTexts.push({
            x: worldX + 17,
            y: worldY - 18,
            vy: -1.8,
            text: "DASH! ⚡",
            color: "#00f2fe",
            alpha: 1.0,
            decay: 0.025
        });
    }

    triggerChaosSwapEffect(swappedPlayers = []) {
        // Full room chaos flash & screen shake
        this.triggerScreenFlash("rgba(255, 0, 128, 0.45)", 400);
        this.triggerScreenShake(6, 260);

        const colors = ["#ff007f", "#a55eea", "#00ffff", "#f1c40f", "#ffffff"];

        (swappedPlayers || []).forEach(p => {
            const px = p.x + 17;
            const py = p.y + 12;

            // Concentric Dimensional Rings
            this.teleportRings.push({
                x: px,
                y: py,
                radius: 4,
                maxRadius: 52,
                color: "#ff007f",
                alpha: 1.0,
                lineWidth: 4,
                decay: 0.03
            });
            this.teleportRings.push({
                x: px,
                y: py,
                radius: 2,
                maxRadius: 38,
                color: "#00ffff",
                alpha: 1.0,
                lineWidth: 2.5,
                decay: 0.04
            });

            // Magic vortex particles
            for (let i = 0; i < 18; i++) {
                const angle = (Math.PI * 2 * i) / 18;
                const speed = 2.5 + Math.random() * 5.0;
                this.particles.push({
                    type: "rainbow_sparkle",
                    x: px,
                    y: py,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size: 3.5 + Math.random() * 4,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    alpha: 1.0,
                    decay: 0.028,
                    rotation: angle,
                    vr: 0.2
                });
            }

            // Floating text
            this.floatingTexts.push({
                x: px,
                y: py - 22,
                vy: -1.6,
                text: "CHAOS SWAP! 🌀",
                color: "#ff007f",
                alpha: 1.0,
                decay: 0.02
            });
        });
    }

    renderParticleEffects(isHitPaused = false) {
        this.ctx.save();

        // 1. Render & Update Teleport / Impact Shockwave Rings
        for (let i = this.teleportRings.length - 1; i >= 0; i--) {
            const ring = this.teleportRings[i];
            if (!isHitPaused) {
                ring.radius += (ring.maxRadius - ring.radius) * 0.16;
                ring.alpha -= ring.decay;
            }

            if (ring.alpha <= 0 || ring.radius >= ring.maxRadius - 1) {
                this.teleportRings.splice(i, 1);
                continue;
            }

            const screenX = ring.x - this.cameraX;
            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, ring.alpha);
            this.ctx.strokeStyle = ring.color;
            this.ctx.shadowColor = ring.color;
            this.ctx.shadowBlur = 8;
            this.ctx.lineWidth = ring.lineWidth;
            this.ctx.beginPath();
            this.ctx.arc(screenX, ring.y, ring.radius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        }

        // 2. Render & Update Burst, Feather, Magic & Arcade Particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            if (!isHitPaused) {
                p.x += p.vx || 0;
                p.y += p.vy || 0;
                if (p.gravity) p.vy = (p.vy || 0) + p.gravity;
                p.alpha -= p.decay;
                p.rotation = (p.rotation || 0) + (p.vr || 0);
            }

            if (p.alpha <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            const screenX = p.x - this.cameraX;
            if (screenX < -80 || screenX > this.width + 80) continue;

            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, p.alpha);

            if (p.type === "feather") {
                // Fluttering Feather with organic wobble
                this.ctx.translate(screenX, p.y);
                p.wobblePhase = (p.wobblePhase || 0) + (p.wobbleSpeed || 0.15);
                const wobble = Math.sin(p.wobblePhase) * 0.35;
                this.ctx.rotate(p.rotation + wobble);

                this.ctx.fillStyle = p.color;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, p.size * 1.5, p.size * 0.65, 0, 0, Math.PI * 2);
                this.ctx.fill();

                // Feather central spine shaft
                this.ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.moveTo(-p.size * 1.3, 0);
                this.ctx.lineTo(p.size * 1.3, 0);
                this.ctx.stroke();

            } else if (p.type === "wind_puff") {
                // Expanding soft circular wind puff
                p.radius = (p.radius || 4) + ((p.maxRadius || 14) - (p.radius || 4)) * 0.12;
                this.ctx.fillStyle = p.color || "rgba(255, 255, 255, 0.75)";
                this.ctx.beginPath();
                this.ctx.arc(screenX, p.y, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

            } else if (p.type === "speed_streak") {
                // Glowing Neon Speed Streak Line
                this.ctx.strokeStyle = p.color;
                this.ctx.shadowColor = p.color;
                this.ctx.shadowBlur = 8;
                this.ctx.lineWidth = 2.5;
                this.ctx.beginPath();
                this.ctx.moveTo(screenX, p.y);
                this.ctx.lineTo(screenX + (p.length || 24), p.y);
                this.ctx.stroke();

            } else if (p.type === "rainbow_sparkle") {
                // 4-Pointed diamond sparkle star
                this.drawMiniDizzyStar(screenX, p.y, p.size, p.rotation, p.color, "#ffffff", false);

            } else if (p.type === "water_drop") {
                // Translucent watery splash droplet
                this.ctx.fillStyle = p.color;
                this.ctx.shadowColor = p.color;
                this.ctx.shadowBlur = 6;
                this.ctx.beginPath();
                this.ctx.arc(screenX, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fill();

                // Water droplet white glint
                this.ctx.fillStyle = "#ffffff";
                this.ctx.beginPath();
                this.ctx.arc(screenX - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.35, 0, Math.PI * 2);
                this.ctx.fill();

            } else if (p.type === "ice_shard") {
                // Angular crystal ice shard
                this.ctx.translate(screenX, p.y);
                this.ctx.rotate(p.rotation);
                this.ctx.fillStyle = p.color;
                this.ctx.shadowColor = "#70c5ce";
                this.ctx.shadowBlur = 6;
                this.ctx.beginPath();
                this.ctx.moveTo(0, -p.size);
                this.ctx.lineTo(p.size * 0.75, 0);
                this.ctx.lineTo(0, p.size * 0.85);
                this.ctx.lineTo(-p.size * 0.65, 0);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.strokeStyle = "#ffffff";
                this.ctx.lineWidth = 1;
                this.ctx.stroke();

            } else if (p.type === "dark_miasma") {
                // Sinister wispy smoke blob
                this.ctx.translate(screenX, p.y);
                this.ctx.rotate(p.rotation);
                this.ctx.shadowColor = p.color;
                this.ctx.shadowBlur = 12;
                this.ctx.fillStyle = p.color;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, p.size, 0, Math.PI * 2);
                this.ctx.fill();

            } else if (p.type === "dimensional_beam") {
                // Connecting dimensional lightning beam
                const sX1 = p.x1 - this.cameraX;
                const sX2 = p.x2 - this.cameraX;
                this.ctx.strokeStyle = p.color;
                this.ctx.shadowColor = "#00ffff";
                this.ctx.shadowBlur = 12;
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.moveTo(sX1, p.y1);
                const midX = (sX1 + sX2) / 2 + (Math.random() - 0.5) * 16;
                const midY = (p.y1 + p.y2) / 2 + (Math.random() - 0.5) * 16;
                this.ctx.lineTo(midX, midY);
                this.ctx.lineTo(sX2, p.y2);
                this.ctx.stroke();

            } else {
                // Default particle
                this.ctx.translate(screenX, p.y);
                this.ctx.rotate(p.rotation);
                this.ctx.fillStyle = p.color;
                this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            }

            this.ctx.restore();
        }

        // 3. Render & Update Death Entities (Upward bounce + rapid spin fall)
        for (let i = this.deathEntities.length - 1; i >= 0; i--) {
            const d = this.deathEntities[i];
            if (!isHitPaused) {
                d.x += d.vx;
                d.vy += 0.45; // Gravity pull
                d.y += d.vy;
                d.rotation += d.vr;
                d.alpha -= d.decay;
            }

            if (d.alpha <= 0 || d.y > this.height + 100) {
                this.deathEntities.splice(i, 1);
                continue;
            }

            const screenX = d.x - this.cameraX;
            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, d.alpha);
            this.ctx.translate(screenX, d.y);
            this.ctx.rotate(d.rotation);

            // Draw spinning red death bird shape
            this.ctx.fillStyle = d.isLocal ? "#e74c3c" : "#e67e22";
            this.ctx.fillRect(-17, -12, 34, 24);
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(-17, -12, 34, 24);

            // Draw "X" eyes for death feedback
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(4, -6); this.ctx.lineTo(10, 0);
            this.ctx.moveTo(10, -6); this.ctx.lineTo(4, 0);
            this.ctx.stroke();

            this.ctx.restore();
        }

        // 4. Render & Update Floating Texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            if (!isHitPaused) {
                ft.y += ft.vy;
                ft.alpha -= ft.decay;
            }

            if (ft.alpha <= 0) {
                this.floatingTexts.splice(i, 1);
                continue;
            }

            const screenX = ft.x - this.cameraX;
            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, ft.alpha);
            this.ctx.fillStyle = ft.color;
            this.ctx.strokeStyle = "#000000";
            this.ctx.lineWidth = 3;
            this.ctx.shadowColor = ft.color;
            this.ctx.shadowBlur = 8;
            this.ctx.font = "bold 13px 'Press Start 2P', 'Kanit', sans-serif";
            this.ctx.textAlign = "center";
            this.ctx.strokeText(ft.text, screenX, ft.y);
            this.ctx.fillText(ft.text, screenX, ft.y);
            this.ctx.restore();
        }

        this.ctx.restore();
    }

    renderScreenFlashes() {
        const now = Date.now();
        for (let i = this.screenFlashes.length - 1; i >= 0; i--) {
            const flash = this.screenFlashes[i];
            if (now > flash.until) {
                this.screenFlashes.splice(i, 1);
                continue;
            }

            const remaining = flash.until - now;
            const alphaRatio = Math.min(1.0, remaining / flash.duration);
            this.ctx.save();
            this.ctx.fillStyle = flash.color;
            this.ctx.globalAlpha = alphaRatio;
            this.ctx.fillRect(0, 0, this.width, this.height);
            this.ctx.restore();
        }
    }

    renderAfterimages(isHitPaused = false) {
        for (let i = this.afterimages.length - 1; i >= 0; i--) {
            const a = this.afterimages[i];
            if (!isHitPaused) {
                a.alpha -= a.decay;
            }
            if (a.alpha <= 0) {
                this.afterimages.splice(i, 1);
                continue;
            }

            const screenX = a.x - this.cameraX;
            if (screenX < -60 || screenX > this.width + 60) continue;

            this.ctx.save();
            this.ctx.globalAlpha = Math.max(0, a.alpha);
            this.ctx.shadowColor = `hsl(${a.hue}, 100%, 65%)`;
            this.ctx.shadowBlur = 10;
            this.ctx.translate(screenX + 17, a.y + 12);
            const rot = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, ((a.velocityY || 0) * 0.1)));
            this.ctx.rotate(rot);

            // Arcade Neon Ghost Silhouette
            this.ctx.fillStyle = `hsl(${a.hue}, 100%, 70%)`;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
            this.ctx.fill();

            // Neon stroke outline
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.lineWidth = 1.5;
            this.ctx.stroke();

            this.ctx.restore();
        }
    }

    render(now) {
        const frameInterval = 1000 / 60; // Strictly synced to 60 FPS (16.6ms) physics tick
        const delta = now - this.lastFrameTime;

        if (delta < frameInterval - 1) {
            return;
        }

        this.lastFrameTime = now;
        this.frameCount++;

        // Micro Hit-Pause (Freeze-Frame): Brief 1-2 frame freeze on impact for arcade crunch
        const isHitPaused = (now < this.hitPauseUntil);

        this.ctx.clearRect(0, 0, this.width, this.height);

        const localBird = this.physics.predictedState;
        const isWidescreen = this.width > 500;
        const birdScreenX = isWidescreen 
            ? Math.min(260, Math.max(90, Math.round(this.width * 0.22))) 
            : Math.max(50, Math.round(this.width * 0.20));

        if (this.modeId === "flappy_boss" && (!this.bossState || this.bossState.status !== "victory_run")) {
            const arenaW = 1140;
            const idealCamX = -(this.width - arenaW) / 2;
            this.cameraX = Math.min(60, idealCamX);
        } else {
            this.cameraX = localBird.x - birdScreenX;
        }

        // Apply Screen Shake if active (plus subtle tremor during hit-pause)
        this.applyScreenShake(isHitPaused);

        // 1. Render Dynamic Parallax Background with Cross-Fade Transitions
        this.renderBackground();

        // 2. Render Checkpoints & Finish Line
        this.renderCheckpointsAndFinish();

        // 3. Render Pipes / Boss Arena
        if (this.modeId === "flappy_boss") {
            this.renderBossArena();
        } else {
            this.renderPipes();
            this.renderItemBoxes();
        }

        // 5. Render Birds & Chain (with ghost afterimages)
        this.renderChains();
        this.renderBirds(isHitPaused);

        // 5.5. Render Particle Systems & Death Entities
        this.renderParticleEffects(isHitPaused);

        // 6. Render Ground Strip
        this.renderGround();

        // 7. Render Screen Flash Overlays
        this.renderScreenFlashes();

        // 8. Render Ink Splat Attack Screen Overlay
        this.renderInkOverlay();

        // 9. Render Real-time Shaking Death Note Book Effect & Soul Reaper Miasma
        this.renderDeathNoteEffect();

        // 10. Render Racing Progress Bar HUD (Track Tracker)
        this.renderRacingProgressBar();

        // Restore screen shake
        this.restoreScreenShake();
    }

    renderDeathNoteEffect() {
        if (!window.deathnoteEffectUntil || Date.now() > window.deathnoteEffectUntil) return;
        this.ctx.save();
        const shakeX = (Math.random() - 0.5) * 12;
        const shakeY = (Math.random() - 0.5) * 12;

        const centerX = this.width / 2 + shakeX;
        const centerY = this.height / 2 + shakeY;

        // Dark aura vignette overlay
        this.ctx.fillStyle = "rgba(10, 0, 0, 0.45)";
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Emit rising Dark Miasma / Soul Reaper Aura particles
        const miasmaColors = ["#1e272e", "#4834d4", "#686de0", "#2c2c54", "#8e44ad"];
        if (Math.random() < 0.7) {
            this.particles.push({
                type: "dark_miasma",
                x: centerX + (Math.random() - 0.5) * 70 + this.cameraX,
                y: centerY + 25 + Math.random() * 20,
                vx: (Math.random() - 0.5) * 1.5,
                vy: -2.0 - Math.random() * 2.2,
                size: 7 + Math.random() * 9,
                color: miasmaColors[Math.floor(Math.random() * miasmaColors.length)],
                alpha: 0.85,
                decay: 0.035,
                rotation: Math.random() * Math.PI,
                vr: 0.05
            });
        }

        // Shaking Death Note Book Icon / Box
        const dnImg = (this.itemImages && this.itemImages.deathnote) || (this.images && this.images.deathnote);
        if (dnImg && dnImg.complete && dnImg.naturalWidth > 0) {
            this.ctx.shadowColor = "#e74c3c";
            this.ctx.shadowBlur = 18;
            this.ctx.drawImage(dnImg, centerX - 36, centerY - 48, 72, 96);
            this.ctx.shadowBlur = 0;
        } else {
            this.ctx.fillStyle = "#111111";
            this.ctx.fillRect(centerX - 36, centerY - 48, 72, 96);
            this.ctx.strokeStyle = "#d9534f";
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(centerX - 36, centerY - 48, 72, 96);

            this.ctx.fillStyle = "#ffffff";
            this.ctx.font = "8px 'Press Start 2P'";
            this.ctx.textAlign = "center";
            this.ctx.textBaseline = "middle";
            this.ctx.fillText("DEATH", centerX, centerY - 12);
            this.ctx.fillText("NOTE", centerX, centerY + 12);
        }

        // Banner Text (Victim Name & Hit Info - only displayed on target's screen)
        this.ctx.fillStyle = "#ff4757";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 4;
        this.ctx.font = "11px 'Press Start 2P'";
        this.ctx.textAlign = "center";
        const bannerMsg = window.deathnoteBannerText || "DEATH NOTE STRUCK YOU!";
        this.ctx.strokeText(bannerMsg, centerX, centerY + 76);
        this.ctx.fillText(bannerMsg, centerX, centerY + 76);

        if (window.deathnoteSubText) {
            this.ctx.fillStyle = "#f1c40f";
            this.ctx.font = "9px 'Press Start 2P'";
            this.ctx.strokeText(window.deathnoteSubText, centerX, centerY + 96);
            this.ctx.fillText(window.deathnoteSubText, centerX, centerY + 96);
        }

        this.ctx.restore();
    }

    renderInkOverlay() {
        const isInkActive = (window.localInkUntil && Date.now() < window.localInkUntil) || (this.physics && this.physics.localIsBucketHead);
        if (!isInkActive) return;

        this.ctx.save();
        const now = Date.now();
        let alpha = 1.0;
        if (window.localInkUntil) {
            const remaining = window.localInkUntil - now;
            alpha = Math.max(0.3, Math.min(1.0, remaining / 400));
        }
        this.ctx.globalAlpha = alpha;

        // Heavy Vision Darkness Effect: Pure dark radial fog obscuring forward vision and surrounding pipes
        const localBird = this.physics ? this.physics.predictedState : null;
        const birdScreenX = localBird ? (localBird.x - this.cameraX + 17) : (this.width * 0.3);
        const birdScreenY = localBird ? (localBird.y + 12) : (this.height * 0.5);

        const blindGrad = this.ctx.createRadialGradient(
            birdScreenX, birdScreenY, 30,
            birdScreenX + 80, birdScreenY, 200
        );
        blindGrad.addColorStop(0, "rgba(0, 0, 0, 0.10)");
        blindGrad.addColorStop(0.35, "rgba(12, 10, 16, 0.85)");
        blindGrad.addColorStop(0.7, "rgba(8, 6, 10, 0.97)");
        blindGrad.addColorStop(1, "rgba(2, 2, 4, 0.99)");

        this.ctx.fillStyle = blindGrad;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Ambient dark vignette across whole screen
        const screenEdgeGrad = this.ctx.createRadialGradient(
            this.width / 2, this.height / 2, this.width * 0.35,
            this.width / 2, this.height / 2, this.width * 0.75
        );
        screenEdgeGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
        screenEdgeGrad.addColorStop(1, "rgba(0, 0, 0, 0.85)");
        this.ctx.fillStyle = screenEdgeGrad;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Retro warning header
        this.ctx.fillStyle = "#f39c12";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 3;
        this.ctx.font = "8px 'Press Start 2P', monospace";
        this.ctx.textAlign = "center";
        const wobble = Math.sin(now / 120) * 2;
        this.ctx.strokeText("VISION BLINDNESS!", this.width / 2, 70 + wobble);
        this.ctx.fillText("VISION BLINDNESS!", this.width / 2, 70 + wobble);

        this.ctx.restore();
    }

    getCurrentMapTheme() {
        if (this.modeId === "flappy_boss") {
            return (this.bossState && this.bossState.themeId) ? this.bossState.themeId : "volcano";
        }
        const localX = this.physics.predictedState.x;
        for (let mapData of this.maps) {
            if (mapData.pipes && mapData.pipes.length > 0) {
                const firstPipeX = mapData.pipes[0].x - 300;
                const lastPipeX = mapData.pipes[mapData.pipes.length - 1].x + 300;
                if (localX >= firstPipeX && localX <= lastPipeX) {
                    return mapData.theme_id || "classic_day";
                }
            }
        }
        return (this.maps[0] && this.maps[0].theme_id) ? this.maps[0].theme_id : "classic_day";
    }

    renderBackground() {
        const activeThemeId = this.getCurrentMapTheme();

        // Check theme transition
        if (activeThemeId !== this.targetThemeId) {
            this.targetThemeId = activeThemeId;
            this.fadeAlpha = 0.0;
            this.isFading = true;
        }

        const bgWidth = 288;

        // Parallax X offset: moves 0.15x camera speed (much slower than pipes for 2D depth illusion)
        const parallaxX = -(this.cameraX * 0.15) % bgWidth;

        // Draw helper for a given theme_id
        const drawThemeBg = (themeId, alpha) => {
            this.ctx.save();
            this.ctx.globalAlpha = alpha;

            const themeAsset = this.themeImages[themeId];
            const bgImg = (themeAsset && themeAsset.bg.complete) ? themeAsset.bg : this.images.bg;

            for (let x = parallaxX - bgWidth; x < this.width + bgWidth; x += bgWidth) {
                if (bgImg && bgImg.complete) {
                    this.ctx.drawImage(bgImg, x, 0, bgWidth, this.height);
                } else {
                    this.ctx.fillStyle = "#70c5ce";
                    this.ctx.fillRect(0, 0, this.width, this.height);
                }
            }
            this.ctx.restore();
        };

        if (this.isFading) {
            // Draw old background
            drawThemeBg(this.currentThemeId, 1.0);

            // Advance cross-fade alpha blend
            this.fadeAlpha += 0.025;
            if (this.fadeAlpha >= 1.0) {
                this.fadeAlpha = 1.0;
                this.currentThemeId = this.targetThemeId;
                this.isFading = false;
            }

            // Draw new background over old background with alpha
            drawThemeBg(this.targetThemeId, this.fadeAlpha);
        } else {
            drawThemeBg(this.currentThemeId, 1.0);
        }
    }

    renderGround() {
        const groundY = 616;
        const groundHeight = Math.max(24, this.height - groundY);

        this.ctx.fillStyle = "#ded895";
        this.ctx.fillRect(0, groundY, this.width, groundHeight);

        this.ctx.fillStyle = "#73bf2e";
        this.ctx.fillRect(0, groundY, this.width, 6);
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(0, groundY, this.width, 2);
    }

    renderPipes() {
        const groundY = 616;
        for (let mapData of this.maps) {
            const themeId = mapData.theme_id || "classic_day";
            const themeAsset = this.themeImages[themeId];

            const topImg = (themeAsset && themeAsset.topPipe.complete) ? themeAsset.topPipe : this.images.topPipe;
            const botImg = (themeAsset && themeAsset.bottomPipe.complete) ? themeAsset.bottomPipe : this.images.bottomPipe;

            for (let pipe of mapData.pipes) {
                const screenX = pipe.x - this.cameraX;

                if (screenX + pipe.width < -50 || screenX > this.width + 50) continue;

                // Ensure top pipe connects to ceiling (draw from y <= 0) and collar matches pipe.topY + pipe.height
                let topDrawY = pipe.topY;
                let topDrawHeight = pipe.height;
                if (topDrawY > 0) {
                    topDrawHeight += topDrawY;
                    topDrawY = 0;
                }

                // Ensure bottom pipe reaches safely below ground (groundY) so it never floats
                let botDrawHeight = pipe.height;
                const minBotHeight = Math.max(groundY, this.height) - pipe.bottomY + 120;
                if (botDrawHeight < minBotHeight) {
                    botDrawHeight = minBotHeight;
                }

                if (topImg && topImg.complete) {
                    this.ctx.drawImage(topImg, screenX, topDrawY, pipe.width, topDrawHeight);
                } else {
                    this.ctx.fillStyle = "#74bf2e";
                    this.ctx.fillRect(screenX, topDrawY, pipe.width, topDrawHeight);
                }

                if (botImg && botImg.complete) {
                    this.ctx.drawImage(botImg, screenX, pipe.bottomY, pipe.width, botDrawHeight);
                } else {
                    this.ctx.fillStyle = "#74bf2e";
                    this.ctx.fillRect(screenX, pipe.bottomY, pipe.width, botDrawHeight);
                }
            }
        }
    }

    renderCheckpointsAndFinish() {
        // Never render checkpoint blue dashed lines in Chained Mode or Boss Mode
        if (this.modeId !== "flappy_chained" && this.modeId !== "flappy_boss") {
            for (let chk of this.checkpoints) {
                if (this.finishLineX > 0 && Math.abs(chk.respawn_coordinate_x - this.finishLineX) < 10) continue;
                const screenX = chk.respawn_coordinate_x - this.cameraX;
                if (screenX < -50 || screenX > this.width + 50) continue;

                this.ctx.save();
                this.ctx.strokeStyle = "#3993d0";
                this.ctx.lineWidth = 4;
                this.ctx.setLineDash([8, 8]);
                this.ctx.beginPath();
                this.ctx.moveTo(screenX, 0);
                this.ctx.lineTo(screenX, 616);
                this.ctx.stroke();
                this.ctx.restore();
            }
        }

        // In Boss Mode, NEVER render Finish Line during the boss fights!
        // Only render the REAL finish line once all 3 bosses are defeated and victory_run starts.
        if (this.modeId === "flappy_boss" && (!this.bossState || this.bossState.status !== "victory_run")) {
            return;
        }

        if (this.finishLineX > 0) {
            const finishScreenX = this.finishLineX - this.cameraX;
            if (finishScreenX >= -100 && finishScreenX <= this.width + 100) {
                this.ctx.save();

                const squareSize = 16;
                for (let y = 0; y < 616; y += squareSize) {
                    for (let col = 0; col < 2; col++) {
                        const isWhite = ((y / squareSize) + col) % 2 === 0;
                        this.ctx.fillStyle = isWhite ? "#ffffff" : "#000000";
                        this.ctx.fillRect(finishScreenX + (col * squareSize), y, squareSize, squareSize);
                    }
                }

                this.ctx.fillStyle = "#f7d51d";
                this.ctx.strokeStyle = "#000";
                this.ctx.lineWidth = 4;
                this.ctx.font = "14px 'Press Start 2P'";
                this.ctx.textAlign = "center";
                this.ctx.strokeText("FINISH GOAL", finishScreenX + 16, 30);
                this.ctx.fillText("FINISH GOAL", finishScreenX + 16, 30);

                this.ctx.restore();
            }
        }
    }

    renderItemBoxes() {
        for (let item of this.itemBoxes) {
            if (item.collected || item.isActive === false) continue;
            const screenX = item.x - this.cameraX;
            if (screenX < -50 || screenX > this.width + 50) continue;

            this.ctx.save();

            const floatOffset = Math.sin(performance.now() / 200) * 4;
            const itemY = item.y + floatOffset;

            const boxImg = (this.itemImages && (this.itemImages.lucky_block || this.itemImages.box)) || 
                           (this.images && (this.images.lucky_block || this.images.box));
            if (boxImg && boxImg.complete && boxImg.naturalWidth > 0) {
                this.ctx.shadowColor = "#f1c40f";
                this.ctx.shadowBlur = 10 + Math.sin(performance.now() / 150) * 4;
                this.ctx.drawImage(boxImg, screenX, itemY, 32, 32);
                this.ctx.shadowBlur = 0;
            } else {
                this.ctx.fillStyle = "#f7d51d";
                this.ctx.fillRect(screenX, itemY, 32, 32);
                this.ctx.strokeStyle = "#000";
                this.ctx.lineWidth = 3;
                this.ctx.strokeRect(screenX, itemY, 32, 32);

                this.ctx.fillStyle = "#000";
                this.ctx.font = "16px 'Press Start 2P'";
                this.ctx.textAlign = "center";
                this.ctx.fillText("?", screenX + 16, itemY + 23);
            }

            this.ctx.restore();
        }
    }

    renderBossArena() {
        if (!this.bossState) return;

        // 1. Render Beams (Warning Telegraph & Laser)
        this.renderBossBeams();

        // 2. Render Projectiles (Fireballs, Ice Shards, Void Spheres)
        this.renderBossProjectiles();

        // 3. Render Energy Orbs (Collectible ammunition)
        this.renderEnergyOrbs();

        // 4. Render Boss Entity (Sprite, Floating, Glowing, Wings/Aura, HP Bar)
        if (this.bossState.status !== "victory_run" && this.bossState.status !== "completed") {
            this.renderBoss();
        }
    }

    renderBoss() {
        const b = this.bossState;
        if (!b) return;

        const bx = b.x - this.cameraX;
        const by = b.y;
        const bw = b.width || 72;
        const bh = b.height || 110;
        const now = performance.now();

        this.ctx.save();

        // 1. Hit Flash or Elemental Aura
        if (b.hitFlash) {
            this.ctx.fillStyle = "#ffffff";
            this.ctx.shadowColor = "#ffffff";
            this.ctx.shadowBlur = 25;
        } else {
            this.ctx.shadowColor = b.accentColor || "#ffa502";
            this.ctx.shadowBlur = 16 + Math.sin(now / 180) * 8;
        }

        // 2. Boss Sprite (Image Asset with Aspect-Ratio Scaling & Procedural Fallback)
        const bossImg = this.images && (this.images["boss" + b.bossIndex] || this.images.boss1);
        let spriteRendered = false;
        let drawH = 125;
        let drawW = 125;
        let drawX = bx;
        let drawY = by;

        if (bossImg && bossImg.complete && bossImg.naturalWidth > 0) {
            const nw = bossImg.naturalWidth;
            const nh = bossImg.naturalHeight;
            const aspect = nw / nh;

            if (b.bossIndex === 1) {
                // Boss 1: Fire Dragon (wide wingspan ~1.78 aspect)
                drawH = 112;
                drawW = Math.round(drawH * aspect);
                if (drawW > 205) { drawW = 205; drawH = Math.round(drawW / aspect); }
            } else if (b.bossIndex === 2) {
                // Boss 2: Frost Yeti (muscular broad ~1.12 aspect)
                drawH = 118;
                drawW = Math.round(drawH * aspect);
            } else if (b.bossIndex === 3) {
                // Boss 3: Dune Sandworm (tall serpentine figure-8 ~0.83 aspect)
                drawH = 132;
                drawW = Math.round(drawH * aspect);
            } else if (b.bossIndex === 4) {
                // Boss 4: Candy Witch (~0.74 aspect)
                drawH = 125;
                drawW = Math.round(drawH * aspect);
            } else if (b.bossIndex === 5) {
                // Boss 5: Abyssal Leviathan (~0.99 aspect)
                drawH = 126;
                drawW = Math.round(drawH * aspect);
            } else {
                drawH = 120;
                drawW = Math.round(drawH * aspect);
                if (drawW > 200) { drawW = 200; drawH = Math.round(drawW / aspect); }
            }

            // Align center of sprite to the boss center
            const centerX = bx + bw / 2;
            const centerY = by + bh / 2;
            drawX = Math.round(centerX - drawW / 2);
            drawY = Math.round(centerY - drawH / 2);

            // Subtle vertical breathing / hovering animation
            const breathe = Math.sin(now / 200) * 3;

            // Hit Flash tint
            if (b.hitFlash) {
                this.ctx.filter = "brightness(2.2) contrast(1.4)";
            }

            this.ctx.drawImage(bossImg, drawX, drawY + breathe, drawW, drawH);
            this.ctx.filter = "none";
            spriteRendered = true;
        } else if (b.bossIndex === 1) {
            // === IGNIS THE FIRE WYRM ===
            // Glowing flame wings behind body
            const wingFlap = Math.sin(now / 140) * 12;
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#c0392b";
            this.ctx.beginPath();
            this.ctx.moveTo(bx + bw * 0.4, by + bh * 0.3);
            this.ctx.lineTo(bx + bw + 32, by - 10 + wingFlap);
            this.ctx.lineTo(bx + bw * 0.8, by + bh * 0.6);
            this.ctx.closePath();
            this.ctx.fill();

            // Dragon Torso & Neck
            const bodyGrad = this.ctx.createLinearGradient(bx, by, bx + bw, by + bh);
            bodyGrad.addColorStop(0, b.hitFlash ? "#ffffff" : "#ff4757");
            bodyGrad.addColorStop(1, b.hitFlash ? "#ffffff" : "#c0392b");
            this.ctx.fillStyle = bodyGrad;
            this.ctx.beginPath();
            this.ctx.roundRect ? this.ctx.roundRect(bx, by, bw, bh, 14) : this.ctx.fillRect(bx, by, bw, bh);
            this.ctx.fill();
            this.ctx.strokeStyle = "#1e1e2f";
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            // Magma Molten Core in chest
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#ffa502";
            this.ctx.beginPath();
            this.ctx.arc(bx + bw * 0.45, by + bh * 0.55, 14, 0, Math.PI * 2);
            this.ctx.fill();

            // Fierce Dragon Head & Horns
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#eb4d4b";
            this.ctx.beginPath();
            this.ctx.moveTo(bx, by + 10);
            this.ctx.lineTo(bx - 22, by + 28);
            this.ctx.lineTo(bx, by + 45);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            // Glowing Dragon Eye
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#f1c40f";
            this.ctx.beginPath();
            this.ctx.arc(bx - 6, by + 24, 4, 0, Math.PI * 2);
            this.ctx.fill();

        } else if (b.bossIndex === 2) {
            // === GLACIUS THE FROST TITAN ===
            // Crystalline Shoulder Spikes
            const frostPulse = Math.sin(now / 200) * 4;
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#54a0ff";
            this.ctx.beginPath();
            this.ctx.moveTo(bx + 10, by);
            this.ctx.lineTo(bx + 20, by - 24 + frostPulse);
            this.ctx.lineTo(bx + 35, by);
            this.ctx.lineTo(bx + bw - 10, by);
            this.ctx.lineTo(bx + bw + 10, by - 20 - frostPulse);
            this.ctx.lineTo(bx + bw, by + 20);
            this.ctx.closePath();
            this.ctx.fill();

            // Ice Golem Armored Torso
            const iceGrad = this.ctx.createLinearGradient(bx, by, bx + bw, by + bh);
            iceGrad.addColorStop(0, b.hitFlash ? "#ffffff" : "#00d2d3");
            iceGrad.addColorStop(1, b.hitFlash ? "#ffffff" : "#2e86de");
            this.ctx.fillStyle = iceGrad;
            this.ctx.beginPath();
            this.ctx.roundRect ? this.ctx.roundRect(bx, by, bw, bh, 8) : this.ctx.fillRect(bx, by, bw, bh);
            this.ctx.fill();
            this.ctx.strokeStyle = "#10ac84";
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            // Frost Core Rune
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#c8d6e5";
            this.ctx.beginPath();
            this.ctx.moveTo(bx + bw * 0.5, by + bh * 0.4);
            this.ctx.lineTo(bx + bw * 0.5 + 12, by + bh * 0.55);
            this.ctx.lineTo(bx + bw * 0.5, by + bh * 0.7);
            this.ctx.lineTo(bx + bw * 0.5 - 12, by + bh * 0.55);
            this.ctx.closePath();
            this.ctx.fill();

            // Glowing Cyan Visor
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#00ffff";
            this.ctx.fillRect(bx - 12, by + 26, 26, 7);

        } else {
            // === SHAI-KHAR THE DUNE SANDWORM ===
            // Desert Sand Serpentine Rings
            this.ctx.strokeStyle = b.hitFlash ? "#ffffff" : "#d35400";
            this.ctx.lineWidth = 4;
            for (let i = 0; i < 4; i++) {
                const sandWave = Math.sin((now / 160) + i * 1.5) * 16;
                this.ctx.beginPath();
                this.ctx.moveTo(bx + bw * 0.8, by + 20 + i * 22);
                this.ctx.quadraticCurveTo(bx + bw + 24, by + 20 + i * 22 + sandWave, bx + bw + 42, by + 20 + i * 22);
                this.ctx.stroke();
            }

            // Sand-Carved Body
            const sandGrad = this.ctx.createLinearGradient(bx, by, bx + bw, by + bh);
            sandGrad.addColorStop(0, b.hitFlash ? "#ffffff" : "#e67e22");
            sandGrad.addColorStop(1, b.hitFlash ? "#ffffff" : "#d35400");
            this.ctx.fillStyle = sandGrad;
            this.ctx.beginPath();
            this.ctx.roundRect ? this.ctx.roundRect(bx, by, bw, bh, 20) : this.ctx.fillRect(bx, by, bw, bh);
            this.ctx.fill();
            this.ctx.strokeStyle = "#f39c12";
            this.ctx.lineWidth = 3;
            this.ctx.stroke();

            // Solar Core Ring
            this.ctx.strokeStyle = b.hitFlash ? "#ffffff" : "#f1c40f";
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(bx + bw * 0.5, by + bh * 0.55, 18 + Math.sin(now / 150) * 4, 0, Math.PI * 2);
            this.ctx.stroke();

            // Glowing Amber Maw
            this.ctx.fillStyle = b.hitFlash ? "#ffffff" : "#ff3838";
            this.ctx.beginPath();
            this.ctx.arc(bx - 4, by + 32, 6, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Overhead Boss Name Tag
        this.ctx.fillStyle = "#ffffff";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 2.5;
        this.ctx.font = "bold 7px 'Press Start 2P', monospace";
        this.ctx.textAlign = "center";
        const tagY = spriteRendered ? Math.min(by - 10, drawY - 6) : by - 10;
        this.ctx.strokeText((b.name || "").toUpperCase(), bx + bw / 2, tagY);
        this.ctx.fillText((b.name || "").toUpperCase(), bx + bw / 2, tagY);

        this.ctx.restore();
    }

    renderBossBeams() {
        if (!this.bossState || !this.bossState.beams) return;
        const now = performance.now();

        for (let b of this.bossState.beams) {
            this.ctx.save();
            const beamY = b.y - b.height / 2;

            if (b.isWarning) {
                // Hazard warning telegraph line
                const alpha = 0.25 + Math.sin(now / 80) * 0.18;
                this.ctx.fillStyle = `rgba(231, 76, 60, ${alpha})`;
                this.ctx.fillRect(0, beamY, this.width, b.height);

                this.ctx.strokeStyle = "#e74c3c";
                this.ctx.lineWidth = 1.5;
                this.ctx.setLineDash([8, 6]);
                this.ctx.strokeRect(0, beamY, this.width, b.height);

                this.ctx.fillStyle = "#ff4757";
                this.ctx.font = "bold 8px 'Press Start 2P', monospace";
                this.ctx.textAlign = "center";
                this.ctx.fillText("⚠️ HAZARD WARNING ⚠️", this.width / 2, b.y + 3);
            } else if (b.isFiring) {
                // Intense Energy Laser matching boss theme
                let beamColor = "#ff4757";
                if (this.bossState.bossIndex === 2) {
                    beamColor = "#00ffff"; // Frost Cyan
                } else if (this.bossState.bossIndex === 3) {
                    beamColor = "#f39c12"; // Golden Solar Sand Beam
                } else if (this.bossState.bossIndex === 4) {
                    beamColor = "#fd79a8"; // Sweet Candy Beam
                } else if (this.bossState.bossIndex === 5) {
                    beamColor = "#1dd1a1"; // Abyssal Hydro Beam
                }
                this.ctx.shadowColor = beamColor;
                this.ctx.shadowBlur = 18;

                // Outer beam glow
                this.ctx.fillStyle = beamColor;
                this.ctx.fillRect(0, beamY, this.width, b.height);

                // White core laser
                this.ctx.fillStyle = "#ffffff";
                this.ctx.fillRect(0, b.y - b.height * 0.25, this.width, b.height * 0.5);
            }

            this.ctx.restore();
        }
    }

    renderBossProjectiles() {
        if (!this.bossState || !this.bossState.projectiles) return;
        const now = performance.now();

        for (let p of this.bossState.projectiles) {
            const px = p.x - this.cameraX;
            const py = p.y;
            this.ctx.save();

            if (p.type === "fireball" || p.type === "magma") {
                this.ctx.shadowColor = p.color || "#ff4757";
                this.ctx.shadowBlur = 14;

                // Fireball gradient
                const grad = this.ctx.createRadialGradient(px, py, 2, px, py, p.radius);
                grad.addColorStop(0, "#ffffff");
                grad.addColorStop(0.4, "#ffa502");
                grad.addColorStop(1, p.color || "#ff4757");
                this.ctx.fillStyle = grad;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Trailing flame flame sparks
                this.ctx.fillStyle = "#ff6348";
                this.ctx.beginPath();
                this.ctx.arc(px + p.radius + 6, py + (Math.sin(now / 50) * 3), p.radius * 0.45, 0, Math.PI * 2);
                this.ctx.fill();

            } else if (p.type === "ice_shard") {
                this.ctx.shadowColor = "#00d2d3";
                this.ctx.shadowBlur = 12;
                this.ctx.fillStyle = "#00d2d3";
                this.ctx.strokeStyle = "#ffffff";
                this.ctx.lineWidth = 1.5;

                // Sharp diamond shard pointing left
                this.ctx.beginPath();
                this.ctx.moveTo(px - p.radius * 1.5, py);
                this.ctx.lineTo(px, py - p.radius * 0.6);
                this.ctx.lineTo(px + p.radius * 1.2, py);
                this.ctx.lineTo(px, py + p.radius * 0.6);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();

            } else if (p.type === "ice_mine") {
                this.ctx.shadowColor = "#54a0ff";
                this.ctx.shadowBlur = 12;
                this.ctx.fillStyle = "#54a0ff";
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.strokeStyle = "#ffffff";
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

            } else if (p.type === "sand_orb" || p.type === "sand_spike") {
                // Desert Sand Blast / Dune Tremor Projectile
                this.ctx.shadowColor = p.color || "#e67e22";
                this.ctx.shadowBlur = 14;

                const sGrad = this.ctx.createRadialGradient(px, py, 2, px, py, p.radius);
                sGrad.addColorStop(0, "#fff5cc");
                sGrad.addColorStop(0.4, "#f39c12");
                sGrad.addColorStop(1, p.color || "#d35400");
                this.ctx.fillStyle = sGrad;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Swirling desert dust ring
                this.ctx.strokeStyle = "#f1c40f";
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius + 3, 0, Math.PI * 2);
                this.ctx.stroke();

            } else if (p.type === "candy_magic" || p.type === "candy_orb") {
                // Candy Witch Magic Sparkle
                this.ctx.shadowColor = p.color || "#fd79a8";
                this.ctx.shadowBlur = 14;

                const cGrad = this.ctx.createRadialGradient(px, py, 2, px, py, p.radius);
                cGrad.addColorStop(0, "#ffffff");
                cGrad.addColorStop(0.4, "#fd79a8");
                cGrad.addColorStop(1, p.color || "#e84393");
                this.ctx.fillStyle = cGrad;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Sparkle ring
                this.ctx.strokeStyle = "#ffeaa7";
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius + 3, 0, Math.PI * 2);
                this.ctx.stroke();

            } else if (p.type === "water_bubble" || p.type === "abyssal_orb") {
                // Abyssal Water Bubble
                this.ctx.shadowColor = p.color || "#1dd1a1";
                this.ctx.shadowBlur = 14;

                const wGrad = this.ctx.createRadialGradient(px, py, 2, px, py, p.radius);
                wGrad.addColorStop(0, "#e0fbfb");
                wGrad.addColorStop(0.5, "#48dbfb");
                wGrad.addColorStop(1, p.color || "#10ac84");
                this.ctx.fillStyle = wGrad;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Aqua ripple ring
                this.ctx.strokeStyle = "#ffffff";
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.arc(px - p.radius * 0.3, py - p.radius * 0.3, p.radius * 0.4, 0, Math.PI * 2);
                this.ctx.stroke();

            } else {
                // Void Orb / Vortex Fallback
                this.ctx.shadowColor = p.color || "#9b59b6";
                this.ctx.shadowBlur = 16;

                const vGrad = this.ctx.createRadialGradient(px, py, 3, px, py, p.radius);
                vGrad.addColorStop(0, "#ffffff");
                vGrad.addColorStop(0.5, "#8e44ad");
                vGrad.addColorStop(1, "#2c2c54");
                this.ctx.fillStyle = vGrad;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

                // Outer shockwave ring
                this.ctx.strokeStyle = "#e056fd";
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(px, py, p.radius + 3, 0, Math.PI * 2);
                this.ctx.stroke();
            }

            this.ctx.restore();
        }
    }

    renderEnergyOrbs() {
        if (!this.bossState || !this.bossState.energyOrbs) return;
        const now = performance.now();

        for (let orb of this.bossState.energyOrbs) {
            const ox = orb.x - this.cameraX;
            const oy = orb.y;

            this.ctx.save();
            this.ctx.shadowColor = "#f1c40f";
            this.ctx.shadowBlur = 16 + Math.sin(now / 140) * 6;

            // Radiant Golden Core
            const oGrad = this.ctx.createRadialGradient(ox, oy, 2, ox, oy, orb.radius);
            oGrad.addColorStop(0, "#ffffff");
            oGrad.addColorStop(0.4, "#f7d51d");
            oGrad.addColorStop(1, "#f39c12");
            this.ctx.fillStyle = oGrad;
            this.ctx.beginPath();
            this.ctx.arc(ox, oy, orb.radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Pulsating energy ring
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(ox, oy, orb.radius + 3 + Math.sin(now / 120) * 3, 0, Math.PI * 2);
            this.ctx.stroke();

            // Label above orb
            this.ctx.fillStyle = "#ffffff";
            this.ctx.strokeStyle = "#000000";
            this.ctx.lineWidth = 2;
            this.ctx.font = "bold 6px 'Press Start 2P', monospace";
            this.ctx.textAlign = "center";
            this.ctx.strokeText("⚡ ORB", ox, oy - orb.radius - 4);
            this.ctx.fillText("⚡ ORB", ox, oy - orb.radius - 4);

            this.ctx.restore();
        }
    }

    renderChains() {
        if (this.modeId !== "flappy_chained") return;

        const allBirds = [];
        const localState = this.physics.predictedState;
        allBirds.push({
            id: this.physics.localPlayerId,
            x: localState.x + 17,
            y: localState.y + 12,
            chain_index: (this.physics.localChainIndex !== undefined) ? this.physics.localChainIndex : 0
        });

        for (let remote of this.physics.remotePlayers.values()) {
            allBirds.push({
                id: remote.player_id,
                x: remote.x + 17,
                y: remote.y + 12,
                chain_index: (remote.chain_index !== undefined) ? remote.chain_index : 0
            });
        }

        allBirds.sort((a, b) => a.chain_index - b.chain_index);

        if (allBirds.length < 2) return;

        for (let i = 0; i < allBirds.length - 1; i++) {
            const birdA = allBirds[i];
            const birdB = allBirds[i + 1];

            let screenXA = birdA.x - this.cameraX;
            let screenYA = birdA.y;
            let screenXB = birdB.x - this.cameraX;
            let screenYB = birdB.y;

            const dx = birdB.x - birdA.x;
            const dy = birdB.y - birdA.y;
            const dist = Math.hypot(dx, dy);

            const isTaut = dist >= 85 && dist < 110;
            const isCritical = dist >= 110;

            // Apply jitter on high tension
            if (isCritical) {
                const jx = (Math.random() - 0.5) * 4;
                const jy = (Math.random() - 0.5) * 4;
                screenXA += jx;
                screenYA += jy;
                screenXB -= jx;
                screenYB -= jy;

                // Tension snap sparks
                if (Math.random() < 0.25) {
                    this.particles.push({
                        type: "spark",
                        x: (birdA.x + birdB.x) / 2 + (Math.random() - 0.5) * 16,
                        y: (birdA.y + birdB.y) / 2 + (Math.random() - 0.5) * 10,
                        vx: (Math.random() - 0.5) * 3,
                        vy: -1.5 - Math.random() * 2.5,
                        size: 2.5 + Math.random() * 2,
                        color: "#fffa65",
                        alpha: 1.0,
                        decay: 0.08
                    });
                }
            }

            this.ctx.save();

            // Calculate sag curvature (when slack, chain dips down)
            const midX = (screenXA + screenXB) / 2;
            const sag = isCritical ? 0 : (isTaut ? Math.max(0, 4 - (dist - 85) * 0.15) : Math.min(22, (85 - dist) * 0.45));
            const midY = (screenYA + screenYB) / 2 + sag;

            // Color and glow settings based on tension state
            let strokeColor = "#8395a7";
            let glowColor = "transparent";
            let glowBlur = 0;

            if (isCritical) {
                strokeColor = "#ff3838";
                glowColor = "#ff3838";
                glowBlur = 12;
            } else if (isTaut) {
                strokeColor = "#f39c12";
                glowColor = "#f39c12";
                glowBlur = 6;
            }

            // Draw underlying heavy tension core cord
            this.ctx.beginPath();
            this.ctx.moveTo(screenXA, screenYA);
            this.ctx.quadraticCurveTo(midX, midY + sag * 0.5, screenXB, screenYB);
            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = isCritical ? 4.5 : 3.5;
            this.ctx.shadowColor = glowColor;
            this.ctx.shadowBlur = glowBlur;
            this.ctx.stroke();

            // Draw stylized iron chain links along curve
            const linkCount = Math.max(4, Math.floor(dist / 14));
            for (let step = 1; step < linkCount; step++) {
                const t = step / linkCount;
                const lx = (1 - t) * (1 - t) * screenXA + 2 * (1 - t) * t * midX + t * t * screenXB;
                const ly = (1 - t) * (1 - t) * screenYA + 2 * (1 - t) * t * (midY + sag * 0.5) + t * t * screenYB;

                this.ctx.save();
                this.ctx.translate(lx, ly);
                const angle = Math.atan2(screenYB - screenYA, screenXB - screenXA);
                this.ctx.rotate(angle);

                // Alternating link orientation
                if (step % 2 === 0) {
                    this.ctx.fillStyle = isCritical ? "#ff4757" : (isTaut ? "#e67e22" : "#a4b0be");
                    this.ctx.strokeStyle = "#1e272e";
                    this.ctx.lineWidth = 1.2;
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                } else {
                    this.ctx.fillStyle = isCritical ? "#ff6b81" : (isTaut ? "#f39c12" : "#ced6e0");
                    this.ctx.strokeStyle = "#1e272e";
                    this.ctx.lineWidth = 1.2;
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 3, 4, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.stroke();
                }
                this.ctx.restore();
            }

            // Central heavy iron buckle
            this.ctx.save();
            this.ctx.translate(midX, midY + sag * 0.5);
            this.ctx.fillStyle = isCritical ? "#ff3838" : (isTaut ? "#f39c12" : "#576574");
            this.ctx.strokeStyle = "#1e272e";
            this.ctx.lineWidth = 2;
            this.ctx.shadowColor = glowColor;
            this.ctx.shadowBlur = glowBlur;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, isCritical ? 6 : 5, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();

            // Inner rivet
            this.ctx.fillStyle = "#ffffff";
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            this.ctx.restore();
        }
    }

    renderBirds(isHitPaused = false) {
        // Collect active afterimages and neon speed streaks for speed boosted birds
        const now = performance.now();
        if (!isHitPaused) {
            // Check local player speed boost
            if (this.physics.localSpeedMultiplier > 1.0) {
                const local = this.physics.predictedState;
                this.afterimages.push({
                    x: local.x,
                    y: local.y,
                    velocityY: local.velocityY,
                    skinId: window.playerSkinId || 0,
                    hatId: window.playerHatId || 0,
                    isLocal: true,
                    alpha: 0.55,
                    decay: 0.05,
                    hue: (now / 2.5) % 360
                });

                // Spawn neon speed line streak
                if (Math.random() < 0.7) {
                    this.particles.push({
                        type: "speed_streak",
                        x: local.x - 4,
                        y: local.y + 4 + Math.random() * 16,
                        length: 24 + Math.random() * 32,
                        color: `hsl(${(now / 2) % 360}, 100%, 65%)`,
                        vx: -7 - Math.random() * 4,
                        alpha: 0.85,
                        decay: 0.055
                    });
                }
            }

            // Check remote players speed boost
            for (let remote of this.physics.remotePlayers.values()) {
                if (remote.speedMultiplier > 1.0) {
                    this.afterimages.push({
                        x: remote.x,
                        y: remote.y,
                        velocityY: remote.velocityY,
                        skinId: remote.skin_ID || 0,
                        hatId: remote.hat_ID || 0,
                        isLocal: false,
                        alpha: 0.5,
                        decay: 0.05,
                        hue: (now / 2.5 + 60) % 360
                    });

                    if (Math.random() < 0.5) {
                        this.particles.push({
                            type: "speed_streak",
                            x: remote.x - 4,
                            y: remote.y + 4 + Math.random() * 16,
                            length: 20 + Math.random() * 26,
                            color: `hsl(${(now / 2 + 60) % 360}, 100%, 65%)`,
                            vx: -6 - Math.random() * 3,
                            alpha: 0.8,
                            decay: 0.06
                        });
                    }
                }
            }
        }

        // Render Afterimages (behind birds)
        this.renderAfterimages(isHitPaused);

        // Render Remote Birds
        for (let remote of this.physics.remotePlayers.values()) {
            const screenX = remote.x - this.cameraX;
            this.drawSingleBird(
                screenX,
                remote.y,
                remote.velocityY,
                remote.skin_ID,
                remote.hat_ID,
                remote.name,
                false,
                remote.hasShield,
                remote.speedMultiplier,
                remote.isInvincible,
                remote.isBucketHead,
                remote.isFrozenInIce,
                remote.isKnockedDown,
                remote.isReadyToFly,
                remote.knockdownUntil,
                remote.isDeadInBoss || false
            );
        }

        // Render Local Bird
        const local = this.physics.predictedState;
        const localScreenX = local.x - this.cameraX;
        this.drawSingleBird(
            localScreenX,
            local.y,
            local.velocityY,
            window.playerSkinId || 0,
            window.playerHatId || 0,
            window.playerName || "YOU",
            true,
            this.physics.localHasShield,
            this.physics.localSpeedMultiplier,
            this.physics.localIsInvincible,
            this.physics.localIsBucketHead,
            this.physics.localIsFrozenInIce,
            this.physics.localIsKnockedDown,
            this.physics.localIsReadyToFly,
            this.physics.localKnockdownUntil,
            this.physics.localIsDeadInBoss || false
        );
    }

    drawMiniDizzyStar(x, y, radius, angle, primaryColor = "#f1c40f", coreColor = "#ffffff", hasGlint = false, glintPhase = 0) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);

        // 4-Pointed diamond star with pixel-crisp cartoon styling
        this.ctx.beginPath();
        const points = 4;
        const innerRadius = radius * 0.38;
        for (let p = 0; p < points * 2; p++) {
            const r = (p % 2 === 0) ? radius : innerRadius;
            const a = (p * Math.PI) / points;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (p === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        this.ctx.fillStyle = primaryColor;
        this.ctx.shadowColor = primaryColor;
        this.ctx.shadowBlur = 8;
        this.ctx.fill();
        this.ctx.strokeStyle = "#d35400";
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        // Inner glowing white core
        this.ctx.beginPath();
        this.ctx.arc(0, 0, Math.max(1, radius * 0.28), 0, Math.PI * 2);
        this.ctx.fillStyle = coreColor;
        this.ctx.fill();

        // Twinkle Glint (cross flare radiating outward)
        if (hasGlint) {
            const glintScale = 0.5 + 0.5 * Math.sin(glintPhase);
            if (glintScale > 0.3) {
                const flareLen = radius * 2.2 * glintScale;
                this.ctx.strokeStyle = "#ffffff";
                this.ctx.lineWidth = 1.8;
                this.ctx.beginPath();
                this.ctx.moveTo(-flareLen, 0); this.ctx.lineTo(flareLen, 0);
                this.ctx.moveTo(0, -flareLen); this.ctx.lineTo(0, flareLen);
                this.ctx.stroke();

                // 45-degree sub-glint
                const subLen = flareLen * 0.5;
                this.ctx.lineWidth = 1.0;
                this.ctx.beginPath();
                this.ctx.moveTo(-subLen, -subLen); this.ctx.lineTo(subLen, subLen);
                this.ctx.moveTo(-subLen, subLen); this.ctx.lineTo(subLen, -subLen);
                this.ctx.stroke();
            }
        }

        this.ctx.restore();
    }

    renderOrbitingDizzyStars(headX, headY) {
        this.ctx.save();
        const numStars = 5;
        const radiusX = 22;
        const radiusY = 7.5;
        const tiltAngle = -0.3; // -17 degrees tilt for 3D elliptical halo
        const now = performance.now();
        const spinSpeed = now / 180; // Smooth orbit speed

        for (let i = 0; i < numStars; i++) {
            const starPhase = spinSpeed + (i * (Math.PI * 2) / numStars);
            const cosP = Math.cos(starPhase);
            const sinP = Math.sin(starPhase);

            // Elliptical coordinates before tilt
            const ox = cosP * radiusX;
            const oy = sinP * radiusY;

            // Apply tilt rotation
            const sx = headX + (ox * Math.cos(tiltAngle) - oy * Math.sin(tiltAngle));
            const sy = headY + (ox * Math.sin(tiltAngle) + oy * Math.cos(tiltAngle));

            // Z-depth calculation (sinP: -1 is back, +1 is front)
            const depth = sinP;
            const starScale = 1.0 + depth * 0.35; // 0.65 to 1.35
            const starAlpha = Math.max(0.45, 0.75 + depth * 0.25); // 0.5 to 1.0
            const starRadius = 5.5 * starScale;
            const starRotate = now / 120 + i;

            // 1. Tiny fading sparkle trail dot
            const trailPhase = starPhase - 0.28;
            const tx = headX + (Math.cos(trailPhase) * radiusX * Math.cos(tiltAngle) - Math.sin(trailPhase) * radiusY * Math.sin(tiltAngle));
            const ty = headY + (Math.cos(trailPhase) * radiusX * Math.sin(tiltAngle) + Math.sin(trailPhase) * radiusY * Math.cos(tiltAngle));

            this.ctx.globalAlpha = starAlpha * 0.5;
            this.ctx.fillStyle = "#ffd32a";
            this.ctx.beginPath();
            this.ctx.arc(tx, ty, Math.max(1, 1.8 * starScale), 0, Math.PI * 2);
            this.ctx.fill();

            // 2. Main golden star with twinkle glint
            this.ctx.globalAlpha = starAlpha;
            const starColor = (i % 2 === 0) ? "#f1c40f" : "#ffa801";
            const glintPhase = (now / 150) + i * 1.5;
            const hasGlint = Math.sin(glintPhase) > 0.45;
            this.drawMiniDizzyStar(sx, sy, starRadius, starRotate, starColor, "#ffffff", hasGlint, glintPhase);
        }

        this.ctx.restore();
    }

    drawSingleBird(x, y, velocityY, skinId, hatId, name, isLocal, hasShield = false, speedMultiplier = 1.0, isInvincible = false, isBucketHead = false, isFrozenInIce = false, isKnockedDown = false, isReadyToFly = false, knockdownUntil = null, isDeadInBoss = false) {
        if (isDeadInBoss) {
            isKnockedDown = true;
        }
        this.ctx.save();

        // If Bucket Head active (Ink hit), render bucket.png above bird head (visible to all players)
        if (isBucketHead) {
            this.ctx.save();
            const bucketImg = (this.itemImages && (this.itemImages.ink || this.itemImages.bucket)) || this.images.bucket;
            if (bucketImg && bucketImg.complete) {
                this.ctx.drawImage(bucketImg, x + 17 - 16, y - 38, 32, 32);
            } else {
                this.drawFallbackPngBox(x + 17 - 14, y - 36, 28, 20, "PNG");
            }
            this.ctx.restore();
        }

        // If Speed Boost active (speedMultiplier > 1.0), draw SpeedBoost icon trailing behind bird
        if (speedMultiplier > 1.0) {
            this.ctx.save();
            const speedIcon = this.itemImages && this.itemImages.speed;
            if (speedIcon && speedIcon.complete) {
                this.ctx.drawImage(speedIcon, x - 16, y + 4, 20, 20);
            }
            this.ctx.restore();
        }

        // If Cursed (speedMultiplier < 1.0), draw Slowness_JE4 icon at bird's tail
        if (speedMultiplier < 1.0) {
            this.ctx.save();
            const slownessIcon = (this.itemImages && (this.itemImages.curse || this.itemImages.slowness)) || this.images.slowness;
            if (slownessIcon && slownessIcon.complete) {
                this.ctx.drawImage(slownessIcon, x - 12, y + 6, 16, 16);
            } else {
                this.ctx.fillStyle = "rgba(138, 43, 226, 0.7)";
                this.ctx.beginPath();
                this.ctx.arc(x - 4, y + 12, 6, 0, Math.PI * 2);
                this.ctx.fill();
            }
            this.ctx.restore();
        }

        // If Shield Active, draw buble.png encapsulating bird with soft aquatic pulse
        if (hasShield) {
            this.ctx.save();
            const bubblePulse = Math.sin(Date.now() / 150) * 1.5;
            const bubbleImg = (this.images && this.images.buble) || (this.itemImages && (this.itemImages.buble || this.itemImages.shield));
            if (bubbleImg && bubbleImg.complete) {
                this.ctx.drawImage(bubbleImg, x + 17 - 28 - bubblePulse, y + 12 - 28 - bubblePulse, 56 + bubblePulse * 2, 56 + bubblePulse * 2);
            } else {
                this.ctx.strokeStyle = "#40e0d0";
                this.ctx.shadowColor = "#40e0d0";
                this.ctx.shadowBlur = 10;
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.arc(x + 17, y + 12, 24 + bubblePulse, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.fillStyle = "rgba(64, 224, 208, 0.25)";
                this.ctx.fill();
            }
            this.ctx.restore();
        }

        // If Invincible (Super Star Rainbow Invincibility)
        if (isInvincible) {
            const rainbowHue = Math.floor((Date.now() / 2.5) % 360);
            this.ctx.save();

            // Pulsing Rainbow Aura Ring
            const pulseR = 27 + Math.sin(Date.now() / 90) * 3;
            this.ctx.shadowColor = `hsl(${rainbowHue}, 100%, 65%)`;
            this.ctx.shadowBlur = 16;
            this.ctx.strokeStyle = `hsl(${rainbowHue}, 100%, 65%)`;
            this.ctx.lineWidth = 3.5;
            this.ctx.beginPath();
            this.ctx.arc(x + 17, y + 12, pulseR, 0, Math.PI * 2);
            this.ctx.stroke();

            this.ctx.fillStyle = `hsla(${rainbowHue}, 100%, 70%, 0.22)`;
            this.ctx.fill();

            // 4 Orbiting Rainbow Super Star Sparkles
            const now = Date.now();
            for (let s = 0; s < 4; s++) {
                const starA = (now / 200) + (s * Math.PI / 2);
                const starHue = (rainbowHue + s * 90) % 360;
                const sx = x + 17 + Math.cos(starA) * 32;
                const sy = y + 12 + Math.sin(starA) * 32;
                this.drawMiniDizzyStar(sx, sy, 5.5, starA * 2, `hsl(${starHue}, 100%, 65%)`, "#ffffff", true, now / 100 + s);
            }
            this.ctx.restore();

            // Spawn trailing rainbow sparkle stars behind bird
            if (Math.random() < 0.5) {
                const trailHue = (rainbowHue + (Math.random() - 0.5) * 60) % 360;
                this.particles.push({
                    type: "rainbow_sparkle",
                    x: x + 17 - 12 + (Math.random() - 0.5) * 8,
                    y: y + 12 + (Math.random() - 0.5) * 12,
                    vx: -2.2 - Math.random() * 2.0,
                    vy: (Math.random() - 0.5) * 1.5,
                    color: `hsl(${trailHue}, 100%, 65%)`,
                    size: 3.5 + Math.random() * 4,
                    alpha: 1.0,
                    decay: 0.04,
                    rotation: Math.random() * Math.PI,
                    vr: 0.18
                });
            }
        }

        // If Frozen in Ice, render Ice Block overlay over bird with frosty crystal sheen
        if (isFrozenInIce) {
            this.ctx.save();
            const iceImg = this.itemImages && this.itemImages.ice;
            if (iceImg && iceImg.complete) {
                this.ctx.drawImage(iceImg, x + 17 - 24, y + 12 - 24, 48, 48);
            } else {
                this.ctx.fillStyle = "rgba(112, 197, 206, 0.65)";
                this.ctx.strokeStyle = "#3993d0";
                this.ctx.shadowColor = "#70c5ce";
                this.ctx.shadowBlur = 8;
                this.ctx.lineWidth = 3;
                this.ctx.fillRect(x + 17 - 22, y + 12 - 20, 44, 40);
                this.ctx.strokeRect(x + 17 - 22, y + 12 - 20, 44, 40);
                this.ctx.fillStyle = "#ffffff";
                this.ctx.font = "8px 'Press Start 2P'";
                this.ctx.textAlign = "center";
                this.ctx.strokeText("ICE", x + 17, y + 16);
                this.ctx.fillText("ICE", x + 17, y + 16);
            }
            this.ctx.restore();
        }

        // Compute bird rotation (comically tumble backward while falling, lying flat with dazed wobble on ground)
        let rotationAngle;
        if (isKnockedDown) {
            if (y < 586) {
                // Falling mid-air: comically tumbling backward from impact recoil
                rotationAngle = -Math.PI * 0.35 + (velocityY || 0) * 0.08;
            } else {
                // Grounded: lying sideways with gentle dazed breathing heave
                const dazeWobble = Math.sin(Date.now() / 150) * 0.06;
                rotationAngle = (Math.PI / 2 * 0.82) + dazeWobble;
            }
        } else {
            rotationAngle = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (velocityY * 0.1)));
        }

        // Compute rotated head center coordinates (bird local center is at +17, +12, head is at offset +8, -4)
        const headLocalX = 8;
        const headLocalY = -4;
        const headX = (x + 17) + (headLocalX * Math.cos(rotationAngle) - headLocalY * Math.sin(rotationAngle));
        const headY = (y + 12) + (headLocalX * Math.sin(rotationAngle) + headLocalY * Math.cos(rotationAngle)) - 4;

        // Render Bird Body & Hat
        this.ctx.save();
        this.ctx.translate(x + 17, y + 12);
        this.ctx.rotate(rotationAngle);

        const birdImgKey = `bird${this.animFrame}`;
        const img = this.images[birdImgKey] || this.images.bird0;

        if (img && img.complete) {
            if (isInvincible) {
                const rainbowHue = Math.floor((Date.now() / 2.5) % 360);
                this.ctx.filter = `hue-rotate(${rainbowHue}deg) saturate(2.4) brightness(1.2)`;
            } else {
                this.applySkinFilter(skinId);
            }
            this.ctx.drawImage(img, -17, -12, 34, 24);
        } else {
            if (isInvincible) {
                const rainbowHue = Math.floor((Date.now() / 2.5) % 360);
                this.ctx.fillStyle = `hsl(${rainbowHue}, 100%, 60%)`;
            } else {
                this.ctx.fillStyle = this.getSkinColorHex(skinId);
            }
            this.ctx.fillRect(-17, -12, 34, 24);
        }

        this.drawHat(hatId);
        this.ctx.restore();

        // If Knocked Down or Dead in Boss: render 3D Orbiting Dizzy Stars or DEAD badge
        if (isKnockedDown) {
            if (isDeadInBoss) {
                // Render Dead badge while awaiting boss defeat / team wipe
                this.ctx.save();
                this.ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
                this.ctx.strokeStyle = "#ff4757";
                this.ctx.lineWidth = 2;
                const badgeW = 96;
                const badgeH = 18;
                const badgeY = Math.min(headY - 26, y - 26);
                this.ctx.fillRect(x + 17 - badgeW / 2, badgeY, badgeW, badgeH);
                this.ctx.strokeRect(x + 17 - badgeW / 2, badgeY, badgeW, badgeH);

                this.ctx.fillStyle = "#ff4757";
                this.ctx.font = "bold 8px 'Press Start 2P', monospace";
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                this.ctx.fillText("💀 DEAD", x + 17, badgeY + 10);
                this.ctx.restore();
            } else {
                // Render 3D tilted orbiting dizzy stars circling around bird's head throughout knockdown
                this.renderOrbitingDizzyStars(headX, headY);

                if (!isReadyToFly) {
                    // Countdown badge while knocked down
                    this.ctx.save();
                    const now = Date.now();
                    const remainingSec = Math.max(0, Math.ceil(((knockdownUntil || (now + 5000)) - now) / 1000));
                    this.ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
                    this.ctx.strokeStyle = "#e74c3c";
                    this.ctx.lineWidth = 2;
                    const badgeW = 92;
                    const badgeH = 18;
                    const badgeY = Math.min(headY - 26, y - 26);
                    this.ctx.fillRect(x + 17 - badgeW / 2, badgeY, badgeW, badgeH);
                    this.ctx.strokeRect(x + 17 - badgeW / 2, badgeY, badgeW, badgeH);

                    this.ctx.fillStyle = "#ffffff";
                    this.ctx.font = "bold 8px 'Press Start 2P', monospace";
                    this.ctx.textAlign = "center";
                    this.ctx.textBaseline = "middle";
                    this.ctx.fillText(`DOWN ${remainingSec}s`, x + 17, badgeY + 10);
                    this.ctx.restore();
                } else {
                // 5s passed! Ready to fly pulsing indicator
                this.ctx.save();
                const bounce = Math.sin(Date.now() / 120) * 3;
                const pulseAlpha = 0.85 + Math.sin(Date.now() / 150) * 0.15;
                this.ctx.fillStyle = `rgba(40, 167, 69, ${pulseAlpha})`;
                this.ctx.strokeStyle = "#f7d51d";
                this.ctx.lineWidth = 2;
                const readyW = 126;
                const readyH = 22;
                const badgeY = y - 48 + bounce;
                this.ctx.fillRect(x + 17 - readyW / 2, badgeY, readyW, readyH);
                this.ctx.strokeRect(x + 17 - readyW / 2, badgeY, readyW, readyH);

                this.ctx.fillStyle = "#ffffff";
                this.ctx.font = "bold 9px 'Press Start 2P', monospace";
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
                this.ctx.fillText("READY TO FLY!", x + 17, badgeY + 11);

                // Call to action sub-text
                this.ctx.fillStyle = "#f7d51d";
                this.ctx.strokeStyle = "#000000";
                this.ctx.lineWidth = 2;
                this.ctx.font = "bold 8px 'Press Start 2P', monospace";
                const subText = isLocal ? "TAP TO FLAP ▲" : "READY";
                this.ctx.strokeText(subText, x + 17, badgeY + 30);
                this.ctx.fillText(subText, x + 17, badgeY + 30);
                this.ctx.restore();
            }
        }
    }

        // Render Player Name Tag & Arrow Indicator
        this.ctx.save();
        this.ctx.fillStyle = isLocal ? "#f7d51d" : "#ffffff";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 3;
        this.ctx.font = "bold 11px 'Press Start 2P', 'Kanit', sans-serif";
        this.ctx.textAlign = "center";

        let labelName = name;
        if (isKnockedDown && isReadyToFly) labelName += " [READY]";
        else if (isKnockedDown) labelName += " [DOWN]";
        else if (isInvincible) labelName += " [STAR]";
        else if (speedMultiplier < 1.0) labelName += " [SLOW]";
        else if (speedMultiplier > 1.0) labelName += " [FAST]";
        else if (isFrozenInIce) labelName += " [ICE]";

        const labelY = isKnockedDown ? (isReadyToFly ? y - 56 : y - 36) : (y - 10);
        this.ctx.strokeText(labelName, x + 17, labelY);
        this.ctx.fillText(labelName, x + 17, labelY);

        if (isLocal) {
            this.ctx.fillStyle = "#55b02e";
            this.ctx.beginPath();
            const arrowBaseY = isKnockedDown ? labelY - 14 : y - 24;
            this.ctx.moveTo(x + 17, arrowBaseY);
            this.ctx.lineTo(x + 11, arrowBaseY - 8);
            this.ctx.lineTo(x + 23, arrowBaseY - 8);
            this.ctx.closePath();
            this.ctx.fill();
        }
        this.ctx.restore();

        this.ctx.restore(); // Matching drawSingleBird opening save()
    }

    // TOP-LEFT RACING PROGRESS BAR UI (Mario Kart Track Tracker style) or RANK SCORE HUD
    renderRankScoreHUD() {
        this.ctx.save();
        const score = (typeof window !== "undefined" && window.rankCurrentScore !== undefined) ? window.rankCurrentScore : 0;
        const centerX = Math.round(this.width / 2);
        const scoreY = 54;

        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        // Big Retro Flappy Bird Score with Shadow & Outline
        this.ctx.font = "32px 'Press Start 2P', sans-serif";
        this.ctx.fillStyle = "#ffffff";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 6;
        this.ctx.strokeText(score.toString(), centerX, scoreY);
        this.ctx.fillText(score.toString(), centerX, scoreY);

        this.ctx.restore();
    }

    renderBossTopBarHUD() {
        const b = this.bossState;
        if (!b) return;

        this.ctx.save();

        const barWidth = Math.min(520, Math.max(220, Math.round(this.width * 0.70)));
        const barX = Math.round((this.width - barWidth) / 2);
        const barY = 22;
        const barHeight = 16;

        // 1. Title Row above the bar: Boss Name & Index (Left) + Player Lives (Right)
        this.ctx.font = "bold 8px 'Press Start 2P', monospace";
        this.ctx.textBaseline = "bottom";

        // Boss Theme Color
        let themeColor = "#ff4757";
        let accentColor = "#ffa502";
        if (b.bossIndex === 2) {
            themeColor = "#00d2d3";
            accentColor = "#54a0ff";
        } else if (b.bossIndex === 3) {
            themeColor = "#f39c12";
            accentColor = "#e67e22";
        } else if (b.bossIndex === 4) {
            themeColor = "#fd79a8";
            accentColor = "#e84393";
        } else if (b.bossIndex === 5) {
            themeColor = "#1dd1a1";
            accentColor = "#10ac84";
        }

        // Draw Boss Name with black outline
        this.ctx.fillStyle = themeColor;
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 3;
        this.ctx.textAlign = "left";
        const bossTitle = `BOSS ${b.bossIndex || 1}/3: ${(b.name || "BOSS").toUpperCase()}`;
        this.ctx.strokeText(bossTitle, barX, barY - 4);
        this.ctx.fillText(bossTitle, barX, barY - 4);

        // Draw Player Lives on the right side of the title row
        this.ctx.textAlign = "right";
        if (this.physics && this.physics.localIsDeadInBoss) {
            this.ctx.fillStyle = "#ff4757";
            this.ctx.strokeText("💀 DEAD", barX + barWidth, barY - 4);
            this.ctx.fillText("💀 DEAD", barX + barWidth, barY - 4);
        } else {
            const lives = (this.physics && this.physics.localBossLives !== undefined) ? this.physics.localBossLives : 2;
            this.ctx.fillStyle = "#f7d51d";
            this.ctx.strokeText(`❤️ LIVES: ${lives}`, barX + barWidth, barY - 4);
            this.ctx.fillText(`❤️ LIVES: ${lives}`, barX + barWidth, barY - 4);
        }

        // 2. Outer Retro Border & Dark Background
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 2.5;
        this.ctx.fillRect(barX, barY, barWidth, barHeight);
        this.ctx.strokeRect(barX, barY, barWidth, barHeight);

        // 3. Inner HP Bar Fill
        const curHp = Math.max(0, b.hp !== undefined ? b.hp : 100);
        const maxHp = Math.max(1, b.maxHp !== undefined ? b.maxHp : 100);
        const hpRatio = Math.max(0, Math.min(1.0, curHp / maxHp));

        if (hpRatio > 0) {
            const fillWidth = Math.round((barWidth - 4) * hpRatio);
            const fillGrad = this.ctx.createLinearGradient(barX + 2, barY + 2, barX + 2 + fillWidth, barY + barHeight - 4);
            fillGrad.addColorStop(0, themeColor);
            fillGrad.addColorStop(1, accentColor);
            this.ctx.fillStyle = fillGrad;
            this.ctx.fillRect(barX + 2, barY + 2, fillWidth, barHeight - 4);

            // Subtle highlight line on top half of fill
            this.ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
            this.ctx.fillRect(barX + 2, barY + 2, fillWidth, Math.round((barHeight - 4) / 2));
        }

        // 4. Numerical HP Text Centered Inside Bar
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.font = "bold 7px 'Press Start 2P', monospace";
        this.ctx.fillStyle = "#ffffff";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 2.5;
        const hpText = b.status === "intermission" 
            ? `PREPARE! NEXT IN ${b.intermissionRemaining || 5}s` 
            : (b.status === "victory_run" ? "VICTORY! FLY TO FINISH! 🏁" : `${curHp} / ${maxHp} HP (${Math.round(hpRatio * 100)}%)`);
        this.ctx.strokeText(hpText, barX + barWidth / 2, barY + barHeight / 2);
        this.ctx.fillText(hpText, barX + barWidth / 2, barY + barHeight / 2);

        this.ctx.restore();
    }

    renderRacingProgressBar() {
        if (this.modeId === "rank" || (typeof window !== "undefined" && window.isRankMode)) {
            this.renderRankScoreHUD();
            return;
        }

        // In Boss Mode: Replace racing checkpoint/winflag progress bar with prominent Boss HP Bar
        if (this.modeId === "flappy_boss") {
            this.renderBossTopBarHUD();
            return;
        }

        this.ctx.save();

        const trackWidth = Math.min(480, Math.max(200, Math.round(this.width * 0.65)));
        const trackX = Math.round((this.width - trackWidth) / 2);
        const trackY = 16;
        const trackHeight = 14;

        // Background Track Box
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        this.ctx.strokeStyle = "#000000";
        this.ctx.lineWidth = 3;
        this.ctx.fillRect(trackX, trackY, trackWidth, trackHeight);
        this.ctx.strokeRect(trackX, trackY, trackWidth, trackHeight);

        // Inner Track Bar
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
        this.ctx.fillRect(trackX + 2, trackY + 2, trackWidth - 4, trackHeight - 4);

        // Collect all active players
        const playersList = [];
        const local = this.physics.predictedState;
        playersList.push({
            id: this.physics.localPlayerId,
            x: local.x,
            skin_ID: window.playerSkinId || 0,
            isLocal: true
        });

        for (let remote of this.physics.remotePlayers.values()) {
            playersList.push({
                id: remote.player_id,
                x: remote.x,
                skin_ID: remote.skin_ID || 0,
                isLocal: false
            });
        }

        // Sort by progression X descending to calculate rank indicators (1st, 2nd, 3rd, 4th)
        playersList.sort((a, b) => b.x - a.x);
        const rankLabels = ["1st", "2nd", "3rd", "4th"];

        const effectiveFinishLineX = (this.finishLineX && this.finishLineX > 500) 
            ? this.finishLineX 
            : ((this.checkpoints && this.checkpoints.length > 0) 
                ? (this.checkpoints[this.checkpoints.length - 1].respawn_coordinate_x + 600) 
                : 4000);
        const totalDist = Math.max(1, effectiveFinishLineX - 100);

        // Render Checkpoint Flags at relative positions along the track (omitted in Chained Mode)
        if (this.modeId !== "flappy_chained" && this.checkpoints && this.checkpoints.length > 0) {
            const chkFlagImg = (this.images && this.images.checkpointflag) || (this.itemImages && this.itemImages.checkpointflag);
            for (let chk of this.checkpoints) {
                const chkX = chk.respawn_coordinate_x || 0;
                if (chkX <= 100 || chkX >= effectiveFinishLineX) continue;

                const ratio = Math.max(0, Math.min(1, (chkX - 100) / totalDist));
                const flagX = trackX + (ratio * (trackWidth - 20));

                if (chkFlagImg && chkFlagImg.complete) {
                    this.ctx.drawImage(chkFlagImg, flagX, trackY - 14, 16, 16);
                } else {
                    this.ctx.fillStyle = "#3993d0";
                    this.ctx.fillRect(flagX + 6, trackY - 4, 4, 18);
                }
            }
        }

        for (let i = 0; i < playersList.length; i++) {
            const p = playersList[i];
            const ratio = Math.max(0, Math.min(1, (p.x - 100) / totalDist));
            const iconX = trackX + (ratio * (trackWidth - 20));
            const iconY = trackY - 2;

            // Mini Bird Icon (16x12 px)
            this.ctx.fillStyle = this.getSkinColorHex(p.skin_ID);
            this.ctx.strokeStyle = "#000000";
            this.ctx.lineWidth = 2;
            this.ctx.fillRect(iconX, iconY, 16, 12);
            this.ctx.strokeRect(iconX, iconY, 16, 12);

            // Mini Eye dot
            this.ctx.fillStyle = "#ffffff";
            this.ctx.fillRect(iconX + 10, iconY + 2, 4, 4);

            // Rank Indicator Badge (1st, 2nd, 3rd, 4th) - NO NAMES ON BAR
            const rankStr = rankLabels[i] || `${i + 1}th`;
            this.ctx.fillStyle = p.isLocal ? "#f7d51d" : "#ffffff";
            this.ctx.strokeStyle = "#000000";
            this.ctx.lineWidth = 2;
            this.ctx.font = "6px 'Press Start 2P'";
            this.ctx.textAlign = "center";
            this.ctx.strokeText(rankStr, iconX + 8, iconY - 4);
            this.ctx.fillText(rankStr, iconX + 8, iconY - 4);
        }

        // Finish Line Flag Icon at 100% mark (far right end of track)
        const winFlagImg = (this.images && this.images.winflag) || (this.itemImages && this.itemImages.winflag);
        if (winFlagImg && winFlagImg.complete) {
            this.ctx.drawImage(winFlagImg, trackX + trackWidth - 16, trackY - 14, 20, 20);
        } else {
            this.ctx.fillStyle = "#f7d51d";
            this.ctx.fillRect(trackX + trackWidth - 6, trackY - 4, 6, 22);
        }

        this.ctx.restore();
    }

    applySkinFilter(skinId) {
        switch (Number(skinId)) {
            case 1:
                // Ruby Red (Primary Red)
                this.ctx.filter = "hue-rotate(310deg) saturate(2.4) brightness(1.05)";
                break;
            case 2:
                // Emerald Green (Vibrant Green)
                this.ctx.filter = "hue-rotate(75deg) saturate(2.0) brightness(1.0)";
                break;
            case 3:
                // Ocean Blue (Primary Blue)
                this.ctx.filter = "hue-rotate(165deg) saturate(2.2) brightness(1.05)";
                break;
            case 4:
                // Royal Purple (Vibrant Purple)
                this.ctx.filter = "hue-rotate(230deg) saturate(2.2) brightness(1.05)";
                break;
            default:
                // Classic Yellow (Primary Yellow)
                this.ctx.filter = "none";
                break;
        }
    }

    getSkinColorHex(skinId) {
        const colors = ["#f7d51d", "#e74c3c", "#2ecc71", "#2980b9", "#8e44ad"];
        return colors[skinId] || colors[0];
    }

    drawHat(hatId) {
        if (!hatId || hatId === 0 || hatId === "none") return;

        this.ctx.save();
        this.ctx.filter = "none";

        const hatKeys = ["none", "crown", "top_hat", "cap", "viking"];
        const hatKey = (typeof hatId === "number") ? hatKeys[hatId] : hatId;
        const hatImg = this.hatImages[hatKey];

        if (hatImg && hatImg.complete) {
            this.ctx.drawImage(hatImg, -16, -36, 32, 32);
        } else {
            this.drawProceduralHatFallback(hatId);
        }

        this.ctx.restore();
    }

    drawProceduralHatFallback(hatId) {
        const idNum = Number(hatId);
        switch (idNum) {
            case 1:
                this.ctx.fillStyle = "#f7d51d";
                this.ctx.strokeStyle = "#000000";
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.moveTo(-10, -12);
                this.ctx.lineTo(-10, -22);
                this.ctx.lineTo(-5, -16);
                this.ctx.lineTo(0, -24);
                this.ctx.lineTo(5, -16);
                this.ctx.lineTo(10, -22);
                this.ctx.lineTo(10, -12);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
                break;

            case 2:
                this.ctx.fillStyle = "#111111";
                this.ctx.fillRect(-14, -14, 28, 4);
                this.ctx.fillRect(-8, -26, 16, 12);
                this.ctx.fillStyle = "#d9534f";
                this.ctx.fillRect(-8, -16, 16, 3);
                break;

            case 3:
                this.ctx.fillStyle = "#d9534f";
                this.ctx.fillRect(-6, -14, 20, 3);
                this.ctx.beginPath();
                this.ctx.arc(-2, -14, 10, Math.PI, 0);
                this.ctx.fill();
                break;

            case 4:
                this.ctx.fillStyle = "#7f8c8d";
                this.ctx.fillRect(-10, -16, 20, 6);
                this.ctx.fillStyle = "#f39c12";
                this.ctx.fillRect(-14, -22, 4, 8);
                this.ctx.fillRect(10, -22, 4, 8);
                break;
        }
    }
}
