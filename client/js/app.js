// Global state references
window.playerName = "";
window.playerSkinId = 0;
window.playerHatId = 0;

document.addEventListener("DOMContentLoaded", () => {
    // Clean query parameters from URL bar without reloading (preserves other query parameters)
    function clearServerQueryParams() {
        if (typeof window !== "undefined" && window.location && window.history && window.history.replaceState) {
            try {
                const url = new URL(window.location.href);
                let changed = false;
                for (let param of ["server", "backend", "ws"]) {
                    if (url.searchParams.has(param)) {
                        url.searchParams.delete(param);
                        changed = true;
                    }
                }
                if (changed) {
                    const newSearch = url.searchParams.toString();
                    const newUrl = url.pathname + (newSearch ? `?${newSearch}` : "") + url.hash;
                    window.history.replaceState({}, document.title, newUrl);
                }
            } catch (e) {
                console.warn("[WebSocket] Failed to clean query params:", e);
            }
        }
    }

    // Parse URL query parameter for custom backend (e.g. ?server=wss://xxxx.trycloudflare.com)
    const urlParams = new URLSearchParams(window.location.search);
    const queryServer = urlParams.get("server") || urlParams.get("backend") || urlParams.get("ws");
    if (queryServer) {
        let formattedServer = queryServer.trim();
        if (!formattedServer.startsWith("ws://") && !formattedServer.startsWith("wss://")) {
            const proto = (window.location.protocol === "https:" || formattedServer.startsWith("https://")) ? "wss://" : "ws://";
            formattedServer = proto + formattedServer.replace(/^https?:\/\//, "");
        }
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("GAME_SERVER_URL", formattedServer);
        }
        window.SERVER_URL = formattedServer;
        clearServerQueryParams();
    }

    // Network Diagnostics & Simulator Instances
    const pingTracker = (typeof PingTracker !== "undefined") ? new PingTracker() : null;
    const networkSimulator = (typeof NetworkSimulator !== "undefined") ? new NetworkSimulator() : null;

    // Native WebSocket client initialization with Exponential Backoff Reconnection
    let ws = null;
    let reconnectAttempts = 0;
    let reconnectTimeout = null;

    function connectWebSocket() {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        if (ws) {
            try {
                ws.onopen = null;
                ws.onmessage = null;
                ws.onerror = null;
                ws.onclose = null;
                ws.close();
            } catch (e) {}
            ws = null;
        }

        const defaultProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const customBackend = window.SERVER_URL || (typeof localStorage !== "undefined" && localStorage.getItem("GAME_SERVER_URL"));
        const wsUrl = customBackend ? customBackend : `${defaultProtocol}//${window.location.host}`;
        
        console.log(`[WebSocket] Connecting to backend: ${wsUrl}`);
        ws = new WebSocket(wsUrl);
        window.ws = ws;

        ws.onopen = () => {
            console.log("[WebSocket] Connection established successfully!");
            reconnectAttempts = 0;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
            if (pingTracker) {
                pingTracker.start((pingPayload) => {
                    rawSendWs("network_ping", pingPayload);
                }, (status) => {
                    updateNetworkIndicatorUI(status);
                });
            }
        };

        ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch (err) {
                console.error("[WebSocket] Failed to parse message:", err);
                return;
            }

            // Application-level pong response directly updates PingTracker (never simulated/delayed)
            if (msg.type === "network_pong") {
                if (pingTracker) {
                    pingTracker.handlePong(msg.data);
                }
                return;
            }

            // Inbound simulator hook
            if (networkSimulator && networkSimulator.enabled) {
                networkSimulator.simulateReceive(msg, (dispatchedMsg) => {
                    if (typeof handleSocketMessage === "function") {
                        handleSocketMessage(dispatchedMsg);
                    }
                });
            } else {
                if (typeof handleSocketMessage === "function") {
                    handleSocketMessage(msg);
                }
            }
        };

        ws.onclose = (event) => {
            console.warn(`[WebSocket] Connection closed (Code: ${event.code}). Scheduling reconnection...`);
            if (pingTracker) {
                pingTracker.stop();
                updateNetworkIndicatorUI(pingTracker.getStatus());
            }
            if (networkSimulator) {
                networkSimulator.clearPending();
            }
            scheduleReconnection();
        };

        ws.onerror = (err) => {
            console.error("[WebSocket] Error detected:", err);
        };
    }

    function scheduleReconnection() {
        if (reconnectTimeout) return;
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000); // 1s, 2s, 4s, 8s, max 10s
        console.log(`[WebSocket] Reconnecting in ${delay}ms (Attempt #${reconnectAttempts})...`);
        reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            connectWebSocket();
        }, delay);
    }

    connectWebSocket();

    // Helper: Direct send JSON message to server
    function rawSendWs(type, data = {}) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type, data }));
            return true;
        } else {
            console.warn(`[WebSocket] Cannot send ${type}: connection state is ${ws ? ws.readyState : "null"}`);
            if (type === "create_lobby" || type === "join_lobby" || type === "start_match") {
                const isStaticDeployment = typeof window !== "undefined" && window.location &&
                    (window.location.hostname.endsWith(".vercel.app") || window.location.hostname.endsWith(".github.io"));
                const currentSavedUrl = (typeof localStorage !== "undefined" && localStorage.getItem("GAME_SERVER_URL")) || window.SERVER_URL || "";
                const defaultProtocol = (typeof window !== "undefined" && window.location && window.location.protocol === "https:") ? "wss:" : "ws:";
                const defaultWsUrl = `${defaultProtocol}//${(typeof window !== "undefined" && window.location) ? window.location.host : "localhost:3000"}`;

                let promptMsg = "Disconnected from Game Server!\n\n";
                if (isStaticDeployment) {
                    promptMsg += "Note: Running on static hosting (e.g. Vercel). An external WebSocket server URL is required.\n\n";
                    promptMsg += "Please enter your active WebSocket Server URL (e.g. wss://xxxx.trycloudflare.com):\n(Or enter ws://localhost:3000 if server runs locally)";
                } else {
                    promptMsg += "Please enter your active WebSocket Server URL (e.g. wss://xxxx.trycloudflare.com or ws://localhost:3000):\n(Leave blank to use default host: " + defaultWsUrl + ")";
                }

                const inputUrl = prompt(promptMsg, currentSavedUrl);
                if (inputUrl !== null) {
                    const trimmed = inputUrl.trim();
                    if (trimmed) {
                        let formatted = trimmed;
                        if (!formatted.startsWith("ws://") && !formatted.startsWith("wss://")) {
                            const proto = (window.location.protocol === "https:" || formatted.startsWith("https://")) ? "wss://" : "ws://";
                            formatted = proto + formatted.replace(/^https?:\/\//, "");
                        }
                        if (typeof localStorage !== "undefined") {
                            localStorage.setItem("GAME_SERVER_URL", formatted);
                        }
                        window.SERVER_URL = formatted;
                        clearServerQueryParams();
                        connectWebSocket();
                        alert("Connecting to " + formatted + "... Please click CREATE/JOIN ROOM again in 2 seconds!");
                    } else {
                        // User submitted blank: Clear stored URL, clear query params, reconnect to default host
                        if (typeof localStorage !== "undefined") {
                            localStorage.removeItem("GAME_SERVER_URL");
                        }
                        window.SERVER_URL = null;
                        clearServerQueryParams();
                        connectWebSocket();

                        if (isStaticDeployment) {
                            alert("Reset to default host. Note: Static hosting requires an external WebSocket server (e.g. Cloudflare Tunnel or PaaS). If connection fails, please provide a server URL.");
                        } else {
                            alert("Reset to default server host (" + defaultWsUrl + "). Reconnecting... Please click CREATE/JOIN ROOM again in 2 seconds!");
                        }
                    }
                }
            }
            return false;
        }
    }

    // Standardized sendWs router (routes through NetworkSimulator if enabled)
    function sendWs(type, data = {}) {
        if (type === "network_ping" || !networkSimulator || !networkSimulator.enabled) {
            return rawSendWs(type, data);
        }
        return networkSimulator.simulateSend(type, data, (t, d) => rawSendWs(t, d));
    }

    // DOM Screens
    const screens = {
        mainMenu: document.getElementById("screen-main-menu"),
        lobbyRoom: document.getElementById("screen-lobby"),
        loadingScreen: document.getElementById("screen-loading"),
        gameView: document.getElementById("screen-game"),
        resultsView: document.getElementById("screen-results")
    };

    // DOM Modals
    const modals = {
        joinLobby: document.getElementById("modal-join"),
        settings: document.getElementById("modal-settings"),
        confirmExit: document.getElementById("modal-confirm-exit")
    };

    // Main Menu Inputs & Buttons
    const nameInput = document.getElementById("input-player-name");
    const btnCreateLobby = document.getElementById("btn-create-lobby");
    const btnOpenJoinModal = document.getElementById("btn-open-join");
    const btnConfirmJoin = document.getElementById("btn-confirm-join");
    const btnCancelJoin = document.getElementById("btn-cancel-join");
    const joinCodeInput = document.getElementById("input-join-code");

    // Revamped Main Menu Navigation Buttons
    const btnMainPlay = document.getElementById("btn-main-play");
    const btnMainCustomize = document.getElementById("btn-main-customize");
    const btnMainSettings = document.getElementById("btn-main-settings");
    const btnPlayRank = document.getElementById("btn-play-rank");
    const btnPlayBack = document.getElementById("btn-play-back");
    const btnCustomizeDone = document.getElementById("btn-customize-done");
    const mainMenuPrimaryActions = document.getElementById("main-menu-primary-actions");
    const mainMenuPlaySubactions = document.getElementById("main-menu-play-subactions");
    const mainMenuCustomizeView = document.getElementById("main-menu-customize-view");

    // Customization Elements
    const skinNameLabel = document.getElementById("skin-name-label");
    const hatNameLabel = document.getElementById("hat-name-label");
    const btnPrevSkin = document.getElementById("btn-prev-skin");
    const btnNextSkin = document.getElementById("btn-next-skin");
    const btnPrevHat = document.getElementById("btn-prev-hat");
    const btnNextHat = document.getElementById("btn-next-hat");
    const previewBirdEl = document.getElementById("preview-bird");

    // Lobby Elements
    const lobbyIdDisplay = document.getElementById("lobby-id-display");
    const btnCopyLobbyId = document.getElementById("btn-copy-lobby-id");
    const btnLeaveLobby = document.getElementById("btn-leave-lobby");
    const playerListEl = document.getElementById("player-list");
    const hostControlsEl = document.getElementById("host-controls-panel");
    const selectMode = document.getElementById("select-game-mode");
    const selectMaps = document.getElementById("select-map-amount");
    const btnToggleReady = document.getElementById("btn-toggle-ready");
    const btnStartMatch = document.getElementById("btn-start-match");
    const btnOpenSettings = document.getElementById("btn-open-settings");
    const btnCloseSettings = document.getElementById("btn-close-settings");

    // In-Game Exit & HUD Elements
    const btnInGameExit = document.getElementById("btn-in-game-exit");
    const btnCancelExit = document.getElementById("btn-cancel-exit");
    const btnConfirmExit = document.getElementById("btn-confirm-exit");
    const hudPipeCount = document.getElementById("hud-pipe-count");
    const finishTimerBanner = document.getElementById("finish-timer-banner");
    const finishTimerSecondsEl = document.getElementById("finish-timer-seconds");
    const startCountdownEl = document.getElementById("start-countdown");

    // Inventory & Action UI Elements
    const hudInventory = document.getElementById("hud-inventory");
    const inventorySlot = document.getElementById("inventory-slot");
    const inventoryEmptyLabel = document.getElementById("inventory-empty-label");
    const inventoryItemIcon = document.getElementById("inventory-item-icon");
    const hudDash = document.getElementById("hud-dash");
    const dashSlot = document.getElementById("dash-slot");
    const dashCooldownOverlay = document.getElementById("dash-cooldown-overlay");
    const dashFabHint = document.getElementById("dash-fab-hint");

    // Results Screen Elements
    const resultsMainHeader = document.getElementById("results-main-header");
    const resultsSubHeader = document.getElementById("results-sub-header");
    const leaderboardHead = document.getElementById("leaderboard-head");
    const leaderboardBody = document.getElementById("leaderboard-body");
    const btnPlayAgain = document.getElementById("btn-play-again");
    const btnReturnToLobby = document.getElementById("btn-return-lobby");
    const btnResultsExitMenu = document.getElementById("btn-results-exit-menu");
    const waitingHostText = document.getElementById("waiting-host-text");

    // Settings Inputs
    const sliderBgm = document.getElementById("slider-bgm");
    const sliderSfx = document.getElementById("slider-sfx");

    // Chat Elements
    const lobbyChatMessages = document.getElementById("lobby-chat-messages");
    const lobbyChatInput = document.getElementById("lobby-chat-input");
    const btnLobbySendChat = document.getElementById("btn-lobby-send-chat");

    const resultsChatMessages = document.getElementById("results-chat-messages");
    const resultsChatInput = document.getElementById("results-chat-input");
    const btnResultsSendChat = document.getElementById("btn-results-send-chat");

    // Canvas Setup
    const canvas = document.getElementById("gameCanvas");
    const physics = new PhysicsEngine();
    const renderer = new CanvasRenderer(canvas, physics);

    // Ground Impact Callback from Physics Engine (comic dust puff & audio feedback)
    window.onGroundImpact = (x, y, isLocal) => {
        if (renderer && typeof renderer.triggerGroundImpact === "function") {
            renderer.triggerGroundImpact(x, y, isLocal);
        }
        if (isLocal && audioManager) {
            audioManager.playSFX("hit");
        }
    };

    // Wing Flap Callback from Physics Engine (wind puff cloud & skin-matching fluttering feathers)
    window.onPlayerFlap = (x, y, skinId, isLocal) => {
        if (renderer && typeof renderer.triggerFlapEffect === "function") {
            renderer.triggerFlapEffect(x, y, skinId, isLocal);
        }
    };

    // Shield Break Callback from Physics Engine (water ripple & splash droplets)
    window.onShieldBreak = (x, y) => {
        if (renderer && typeof renderer.triggerShieldBreakEffect === "function") {
            renderer.triggerShieldBreakEffect(x, y);
        }
    };

    // Ice Shatter Callback from Physics Engine (angular crystal shards burst)
    window.onIceShatter = (x, y) => {
        if (renderer && typeof renderer.triggerIceShatterEffect === "function") {
            renderer.triggerIceShatterEffect(x, y);
        }
    };

    // Device-based Responsive Layout Controller (Mobile Portrait vs Desktop Fullscreen Expanded View)
    function checkIsDesktop() {
        const userAgent = navigator.userAgent || "";
        const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
        // Explicit phone browsers in portrait mode are Mobile
        if (isMobileUA && window.innerWidth < window.innerHeight) {
            return false;
        }
        // Desktop / Large Screens: Viewport width >= 768px and landscape orientation (width > height)
        return window.innerWidth >= 768 && window.innerWidth > window.innerHeight;
    }

    function applyResponsiveLayout() {
        const isDesktop = checkIsDesktop();

        if (isDesktop) {
            document.body.classList.add("layout-desktop");
            document.body.classList.remove("layout-mobile");
        } else {
            document.body.classList.add("layout-mobile");
            document.body.classList.remove("layout-desktop");
        }

        // Authoritative world height fixed at 640 (1:1 sync with server physics and constants)
        const viewportW = window.innerWidth || document.documentElement.clientWidth;
        const viewportH = window.innerHeight || document.documentElement.clientHeight;
        const aspect = (viewportW > 0 && viewportH > 0) ? (viewportW / viewportH) : (isDesktop ? 16 / 9 : 9 / 16);

        const targetHeight = 640;
        const targetWidth = Math.round(targetHeight * aspect);

        renderer.resize(targetWidth, targetHeight);
    }

    applyResponsiveLayout();
    window.addEventListener("resize", applyResponsiveLayout);
    window.addEventListener("orientationchange", () => {
        setTimeout(applyResponsiveLayout, 100);
    });

    let currentLobby = null;
    let localPlayerId = null;
    let gameLoopRunning = false;
    let animationFrameId = null;

    const skins = ["Classic Yellow", "Ruby Red", "Emerald Green", "Ocean Blue", "Royal Purple"];
    const hats = ["None", "Golden Crown", "Top Hat", "Red Cap", "Viking Helmet"];

    // Main Menu Sub-view Reset Helper
    function resetMainMenuUI() {
        if (mainMenuPrimaryActions) mainMenuPrimaryActions.style.display = "flex";
        if (mainMenuPlaySubactions) mainMenuPlaySubactions.style.display = "none";
        if (mainMenuCustomizeView) mainMenuCustomizeView.style.display = "none";
    }

    // Explicit State & Chat Cleanup Helpers
    function clearChatUI() {
        if (lobbyChatMessages) lobbyChatMessages.innerHTML = "";
        if (resultsChatMessages) resultsChatMessages.innerHTML = "";
    }

    function clearLocalPlayerState() {
        physics.clearRemotePlayers();
        clearChatUI();
    }

    // CRITICAL INPUT ISOLATION (Prevent Flap on Typing)
    const allInputElements = document.querySelectorAll("input, textarea, select");
    allInputElements.forEach(inputEl => {
        ["keydown", "keyup", "keypress"].forEach(eventType => {
            inputEl.addEventListener(eventType, (e) => {
                e.stopPropagation(); // Stop event bubbling
            });
        });
    });

    // Primary Colors CSS Filters (Matching in-game Canvas Renderer)
    const skinFilters = [
        "none",                                              // Classic Yellow (Primary Yellow)
        "hue-rotate(310deg) saturate(2.4) brightness(1.05)", // Ruby Red (Primary Red)
        "hue-rotate(75deg) saturate(2.0) brightness(1.0)",   // Emerald Green (Vibrant Green)
        "hue-rotate(165deg) saturate(2.2) brightness(1.05)", // Ocean Blue (Primary Blue)
        "hue-rotate(230deg) saturate(2.2) brightness(1.05)"  // Royal Purple (Vibrant Purple)
    ];

    const hatSources = [
        "", // None
        "assets/images/hats/hat_crown.png",
        "assets/images/hats/hat_top.png",
        "assets/images/hats/hat_cap.png",
        "assets/images/hats/hat_viking.png"
    ];

    // Update customization preview
    function updateCustomizationUI() {
        skinNameLabel.textContent = skins[window.playerSkinId];
        hatNameLabel.textContent = hats[window.playerHatId];

        const birdImg = document.getElementById("preview-bird-img");
        const hatImg = document.getElementById("preview-hat-img");

        if (birdImg) {
            birdImg.style.filter = skinFilters[window.playerSkinId] || "none";
        }

        if (hatImg) {
            const hatSrc = hatSources[window.playerHatId];
            if (hatSrc) {
                hatImg.src = hatSrc;
                hatImg.style.display = "block";
            } else {
                hatImg.style.display = "none";
            }
        }

        if (currentLobby) {
            sendWs("update_customization", {
                skin_ID: window.playerSkinId,
                hat_ID: window.playerHatId,
                name: window.playerName
            });
        }
    }

    // Navigation Helper
    function showScreen(screenKey) {
        for (let key in screens) {
            screens[key].classList.remove("active");
        }
        screens[screenKey].classList.add("active");
        if (screenKey === "mainMenu") {
            resetMainMenuUI();
        }
        if (screenKey === "gameView") {
            applyResponsiveLayout();
        }
    }

    // Customization Event Listeners
    btnPrevSkin.addEventListener("click", () => {
        window.playerSkinId = (window.playerSkinId - 1 + skins.length) % skins.length;
        updateCustomizationUI();
    });

    btnNextSkin.addEventListener("click", () => {
        window.playerSkinId = (window.playerSkinId + 1) % skins.length;
        updateCustomizationUI();
    });

    btnPrevHat.addEventListener("click", () => {
        window.playerHatId = (window.playerHatId - 1 + hats.length) % hats.length;
        updateCustomizationUI();
    });

    btnNextHat.addEventListener("click", () => {
        window.playerHatId = (window.playerHatId + 1) % hats.length;
        updateCustomizationUI();
    });

    nameInput.addEventListener("input", (e) => {
        window.playerName = e.target.value.trim() || "BirdPlayer";
    });

    // Revamped Main Menu Navigation Event Listeners
    if (btnMainPlay) {
        btnMainPlay.addEventListener("click", () => {
            if (mainMenuPrimaryActions) mainMenuPrimaryActions.style.display = "none";
            if (mainMenuPlaySubactions) mainMenuPlaySubactions.style.display = "flex";
        });
    }

    if (btnPlayBack) {
        btnPlayBack.addEventListener("click", () => {
            resetMainMenuUI();
        });
    }

    if (btnMainCustomize) {
        btnMainCustomize.addEventListener("click", () => {
            if (mainMenuPrimaryActions) mainMenuPrimaryActions.style.display = "none";
            if (mainMenuCustomizeView) mainMenuCustomizeView.style.display = "block";
            updateCustomizationUI();
        });
    }

    if (btnCustomizeDone) {
        btnCustomizeDone.addEventListener("click", () => {
            resetMainMenuUI();
        });
    }

    if (btnMainSettings) {
        btnMainSettings.addEventListener("click", () => {
            modals.settings.classList.add("active");
        });
    }

    if (btnPlayRank) {
        btnPlayRank.addEventListener("click", () => {
            startRankMode();
        });
    }

    // ============================================================
    // RANK MODE (CLASSIC SOLO) & MOCK DATABASE / LEADERBOARD
    // ============================================================
    window.isRankMode = false;
    window.rankCurrentScore = 0;
    let rankLastPipeX = 420;
    let rankNextPipeIdx = 1;

    const MOCK_RANK_DB_KEY = "FLAPPY_RANK_MOCK_LEADERBOARD";

    function getRankLeaderboard() {
        try {
            const stored = localStorage.getItem(MOCK_RANK_DB_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {
            console.warn("[Rank DB] Error reading leaderboard from localStorage:", e);
        }

        const defaultLeaderboard = [
            { name: "SkyKing", score: 48, date: "2026-10-12" },
            { name: "AceFlapper", score: 36, date: "2026-10-13" },
            { name: "PixelBird", score: 27, date: "2026-10-14" },
            { name: "WingMaster", score: 19, date: "2026-10-11" },
            { name: "FeatherPro", score: 14, date: "2026-10-14" },
            { name: "CloudRider", score: 10, date: "2026-10-10" },
            { name: "BreezeFlyer", score: 6, date: "2026-10-13" },
            { name: "ChirpChampion", score: 4, date: "2026-10-12" }
        ];
        saveRankLeaderboard(defaultLeaderboard);
        return defaultLeaderboard;
    }

    function saveRankLeaderboard(list) {
        try {
            localStorage.setItem(MOCK_RANK_DB_KEY, JSON.stringify(list));
        } catch (e) {
            console.warn("[Rank DB] Error saving leaderboard to localStorage:", e);
        }
    }

    function recordRankScore(playerName, score) {
        const list = getRankLeaderboard();
        const cleanName = (playerName || "Anonymous").trim().slice(0, 12);
        const newEntry = {
            name: cleanName,
            score: Number(score) || 0,
            date: new Date().toISOString().split("T")[0],
            timestamp: Date.now()
        };
        list.push(newEntry);
        list.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));

        // Find rank of new entry
        const playerRank = list.findIndex(e => e === newEntry) + 1;
        const trimmed = list.slice(0, 30);
        saveRankLeaderboard(trimmed);

        return { leaderboard: trimmed, playerRank, newEntry };
    }

    function generateRankPipes(startPipeIndex = 1, startX = 420, count = 25) {
        const pipes = [];
        const pipeSpacingX = 220;
        const pipeWidth = 52;
        const pipeHeight = 640;
        const groundY = 616;
        const gapSize = 135;
        const minVisibleTopHeight = 60;
        const maxVisibleTopHeight = groundY - gapSize - 60;

        let currentX = startX;

        for (let i = 0; i < count; i++) {
            const pipeIdx = startPipeIndex + i;
            const visibleTopHeight = Math.floor(Math.random() * (maxVisibleTopHeight - minVisibleTopHeight + 1)) + minVisibleTopHeight;
            const topY = visibleTopHeight - pipeHeight;
            const bottomY = visibleTopHeight + gapSize;

            pipes.push({
                pipeIndex: pipeIdx,
                x: currentX,
                width: pipeWidth,
                height: pipeHeight,
                topHeight: visibleTopHeight,
                bottomHeight: groundY - bottomY,
                topY: topY,
                bottomY: bottomY,
                scored: false
            });

            currentX += pipeSpacingX;
        }

        return { pipes, nextStartX: currentX, nextPipeIndex: startPipeIndex + count };
    }

    function checkRankPipeStream() {
        if (!window.isRankMode || !renderer.maps || !renderer.maps[0]) return;
        const currentX = physics.predictedState.x;
        if (currentX > rankLastPipeX - 1200) {
            const nextBatch = generateRankPipes(rankNextPipeIdx, rankLastPipeX, 15);
            rankLastPipeX = nextBatch.nextStartX;
            rankNextPipeIdx = nextBatch.nextPipeIndex;
            renderer.maps[0].pipes.push(...nextBatch.pipes);

            // Prune old pipes that are far behind player to keep memory minimal
            if (renderer.maps[0].pipes.length > 50) {
                renderer.maps[0].pipes = renderer.maps[0].pipes.filter(p => p.x > currentX - 600);
            }
        }
    }

    function checkRankCollisions() {
        if (!window.isRankMode || !gameLoopRunning) return false;

        const state = physics.predictedState;
        const birdWidth = physics.birdWidth || 34;
        const birdHeight = physics.birdHeight || 24;

        // Ground collision (Instant Death)
        if (state.y + birdHeight >= physics.groundY) {
            return true;
        }

        // Ceiling clamping
        if (state.y < 0) {
            state.y = 0;
            state.velocityY = 0;
        }

        // Pipe collision
        if (renderer.maps && renderer.maps[0] && renderer.maps[0].pipes) {
            const pipes = renderer.maps[0].pipes;
            // 3px grace box for fair pixel collision
            const birdBox = {
                x: state.x + 3,
                y: state.y + 3,
                width: birdWidth - 6,
                height: birdHeight - 6
            };

            for (let pipe of pipes) {
                if (pipe.x > state.x + 80 || pipe.x + pipe.width < state.x - 40) continue;

                const topPipeBox = { x: pipe.x, y: pipe.topY, width: pipe.width, height: pipe.height };
                const bottomPipeBox = { x: pipe.x, y: pipe.bottomY, width: pipe.width, height: pipe.height };

                const hitTop = (birdBox.x < topPipeBox.x + topPipeBox.width &&
                                birdBox.x + birdBox.width > topPipeBox.x &&
                                birdBox.y < topPipeBox.y + topPipeBox.height &&
                                birdBox.y + birdBox.height > topPipeBox.y);

                const hitBottom = (birdBox.x < bottomPipeBox.x + bottomPipeBox.width &&
                                   birdBox.x + birdBox.width > bottomPipeBox.x &&
                                   birdBox.y < bottomPipeBox.y + bottomPipeBox.height &&
                                   birdBox.y + birdBox.height > bottomPipeBox.y);

                if (hitTop || hitBottom) {
                    return true;
                }
            }
        }

        return false;
    }

    function checkRankScoring() {
        if (!window.isRankMode || !gameLoopRunning) return;

        const state = physics.predictedState;
        if (renderer.maps && renderer.maps[0] && renderer.maps[0].pipes) {
            const pipes = renderer.maps[0].pipes;
            for (let pipe of pipes) {
                if (!pipe.scored && state.x > pipe.x + pipe.width) {
                    pipe.scored = true;
                    window.rankCurrentScore += 1;
                    audioManager.playSFX("point");
                }
            }
        }
    }

    function startRankMode() {
        window.isRankMode = true;
        window.rankCurrentScore = 0;
        rankLastPipeX = 420;
        rankNextPipeIdx = 1;

        audioManager.playBGM();

        // Reset physics
        physics.resetLocalState(100, 320);
        physics.clearRemotePlayers();
        physics.localHeldItem = null;
        updateInventoryUI(null);

        // Hide multiplayer-specific HUD elements
        if (hudInventory) hudInventory.style.display = "none";
        if (finishTimerBanner) finishTimerBanner.style.display = "none";
        if (hudPipeCount && hudPipeCount.parentElement) hudPipeCount.parentElement.style.display = "none";
        if (hudActivityFeed) hudActivityFeed.innerHTML = "";

        // Generate pipes
        const initialBatch = generateRankPipes(1, 420, 25);
        rankLastPipeX = initialBatch.nextStartX;
        rankNextPipeIdx = initialBatch.nextPipeIndex;

        // Set renderer data
        renderer.setGameData([{ theme_id: "classic_day", pipes: initialBatch.pipes }], [], [], 0, "rank");

        // Transition to game view & start loop
        showScreen("gameView");
        startGameLoop();
    }

    function handleRankGameOver() {
        stopGameLoop();
        audioManager.playSFX("hit");
        audioManager.playSFX("die");
        renderer.triggerDeathEffect(physics.predictedState.x, physics.predictedState.y, true, "GAME OVER");

        const currentName = (nameInput && nameInput.value) ? nameInput.value.trim() : "FlappyHero";
        const result = recordRankScore(currentName, window.rankCurrentScore || 0);

        setTimeout(() => {
            showRankResultsUI(result);
        }, 500);
    }

    function showRankResultsUI(result) {
        showScreen("resultsView");
        updateResultsHostState();

        resultsMainHeader.textContent = "🏆 RANK MODE (SOLO)";
        resultsSubHeader.style.display = "block";
        resultsSubHeader.innerHTML = `YOUR SCORE: <strong style="color: #55b02e; font-size: 14px;">${window.rankCurrentScore || 0}</strong> | RANK: <strong style="color: #f7d51d; font-size: 14px;">#${result.playerRank}</strong>`;

        leaderboardHead.innerHTML = `
            <tr>
                <th>RANK</th>
                <th>PLAYER</th>
                <th>SCORE</th>
            </tr>
        `;

        leaderboardBody.innerHTML = "";
        for (let i = 0; i < result.leaderboard.length; i++) {
            const entry = result.leaderboard[i];
            const rankNum = i + 1;
            let rankMedal = `#${rankNum}`;
            if (rankNum === 1) rankMedal = "🥇 #1";
            else if (rankNum === 2) rankMedal = "🥈 #2";
            else if (rankNum === 3) rankMedal = "🥉 #3";

            const isCurrent = (entry === result.newEntry) || 
                              (entry.timestamp && result.newEntry && entry.timestamp === result.newEntry.timestamp);

            const tr = document.createElement("tr");
            if (isCurrent) {
                tr.className = "current-player-rank-row";
            }

            tr.innerHTML = `
                <td><strong style="color: ${rankNum <= 3 ? '#f7d51d' : '#000'};">${rankMedal}</strong></td>
                <td><strong>${escapeHtml(entry.name)}</strong>${isCurrent ? ' <span class="badge badge-ready">YOU</span>' : ''}</td>
                <td><span style="color: #55b02e; font-weight: bold;">${entry.score}</span></td>
            `;
            leaderboardBody.appendChild(tr);
        }

        btnPlayAgain.style.display = "block";
        btnReturnToLobby.style.display = "none";
        waitingHostText.style.display = "none";
        btnResultsExitMenu.style.display = "block";
    }

    // Create & Join Lobby Actions
    btnCreateLobby.addEventListener("click", () => {
        clearLocalPlayerState();
        window.playerName = nameInput.value.trim() || "BirdPlayer";
        audioManager.playBGM();
        sendWs("create_lobby", {
            name: window.playerName,
            skin_ID: window.playerSkinId,
            hat_ID: window.playerHatId
        });
    });

    btnOpenJoinModal.addEventListener("click", () => {
        modals.joinLobby.classList.add("active");
    });

    btnCancelJoin.addEventListener("click", () => {
        modals.joinLobby.classList.remove("active");
    });

    btnConfirmJoin.addEventListener("click", () => {
        const code = joinCodeInput.value.trim();
        if (!code) return alert("Please enter a Lobby Code!");
        clearLocalPlayerState();
        window.playerName = nameInput.value.trim() || "BirdPlayer";
        audioManager.playBGM();
        sendWs("join_lobby", {
            Lobby_id: code,
            name: window.playerName,
            skin_ID: window.playerSkinId,
            hat_ID: window.playerHatId
        });
        modals.joinLobby.classList.remove("active");
    });

    btnCopyLobbyId.addEventListener("click", () => {
        if (currentLobby) {
            navigator.clipboard.writeText(currentLobby.Lobby_id);
            btnCopyLobbyId.textContent = "COPIED!";
            setTimeout(() => { btnCopyLobbyId.textContent = "COPY"; }, 1500);
        }
    });

    // Leave Room Listener
    btnLeaveLobby.addEventListener("click", () => {
        if (currentLobby) {
            sendWs("leave_lobby");
            currentLobby = null;
            clearLocalPlayerState();
            showScreen("mainMenu");
        }
    });

    // In-Game Exit & Confirmation Modal Listeners
    btnInGameExit.addEventListener("click", () => {
        modals.confirmExit.classList.add("active");
    });

    btnCancelExit.addEventListener("click", () => {
        modals.confirmExit.classList.remove("active");
    });

    btnConfirmExit.addEventListener("click", () => {
        modals.confirmExit.classList.remove("active");
        stopGameLoop();
        if (window.isRankMode) {
            window.isRankMode = false;
        } else if (currentLobby) {
            sendWs("leave_lobby");
            currentLobby = null;
        }
        clearLocalPlayerState();
        resetMainMenuUI();
        showScreen("mainMenu");
    });

    // Settings Modal Listeners
    btnOpenSettings.addEventListener("click", () => {
        modals.settings.classList.add("active");
    });

    btnCloseSettings.addEventListener("click", () => {
        modals.settings.classList.remove("active");
    });

    sliderBgm.addEventListener("input", (e) => {
        audioManager.setBGMVolume(e.target.value / 100);
    });

    sliderSfx.addEventListener("input", (e) => {
        audioManager.setSFXVolume(e.target.value / 100);
    });

    // Host Settings Listeners
    selectMode.addEventListener("change", (e) => {
        sendWs("update_lobby_settings", { mode_id: e.target.value });
    });

    selectMaps.addEventListener("change", (e) => {
        sendWs("update_lobby_settings", { amount_of_map: e.target.value });
    });

    // Ready & Start Controls
    btnToggleReady.addEventListener("click", () => {
        sendWs("toggle_ready");
    });

    btnStartMatch.addEventListener("click", () => {
        sendWs("start_match");
    });

    // Post-Match Controls
    btnPlayAgain.addEventListener("click", () => {
        if (window.isRankMode) {
            startRankMode();
            return;
        }
        sendWs("play_again");
    });

    btnReturnToLobby.addEventListener("click", () => {
        sendWs("return_to_lobby");
    });

    if (btnResultsExitMenu) {
        btnResultsExitMenu.addEventListener("click", () => {
            stopGameLoop();
            if (window.isRankMode) {
                window.isRankMode = false;
            } else if (currentLobby) {
                sendWs("leave_lobby");
                currentLobby = null;
            }
            clearLocalPlayerState();
            resetMainMenuUI();
            showScreen("mainMenu");
        });
    }

    // Real-Time HUD Activity Feed Helper
    const hudActivityFeed = document.getElementById("hud-activity-feed");
    function addActivityFeedLog(htmlText) {
        if (!hudActivityFeed) return;
        const line = document.createElement("div");
        line.className = "feed-line";
        line.innerHTML = htmlText;
        hudActivityFeed.appendChild(line);

        while (hudActivityFeed.children.length > 3) {
            hudActivityFeed.removeChild(hudActivityFeed.firstChild);
        }

        setTimeout(() => {
            if (line.parentNode) line.parentNode.removeChild(line);
        }, 4000);
    }

    // Real-Time Chat System Listeners
    function sendChatFromInput(inputEl) {
        const text = inputEl.value.trim();
        if (text) {
            sendWs("send_chat_message", { message: text });
            inputEl.value = "";
        }
    }

    btnLobbySendChat.addEventListener("click", () => sendChatFromInput(lobbyChatInput));
    lobbyChatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendChatFromInput(lobbyChatInput);
    });

    btnResultsSendChat.addEventListener("click", () => sendChatFromInput(resultsChatInput));
    resultsChatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendChatFromInput(resultsChatInput);
    });

    function escapeHtml(str) {
        return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function updateLobbyUI() {
        if (!currentLobby) return;

        lobbyIdDisplay.textContent = currentLobby.Lobby_id;
        const isHost = (localPlayerId === currentLobby.host_ID);

        playerListEl.innerHTML = "";
        let allReady = true;

        for (let player of currentLobby.players) {
            if (!player.ready_status) allReady = false;

            const item = document.createElement("li");
            item.className = "player-item";

            const hostBadge = (player.player_id === currentLobby.host_ID) ? `<span class="badge badge-host">HOST</span>` : "";
            const readyBadge = player.ready_status ? `<span class="badge badge-ready">READY</span>` : `<span class="badge badge-not-ready">NOT READY</span>`;

            let kickButtonHtml = "";
            if (isHost && player.player_id !== localPlayerId) {
                kickButtonHtml = `<button class="btn btn-kick btn-danger" data-kick-id="${player.player_id}">KICK</button>`;
            }

            item.innerHTML = `
                <div>
                    <strong>${player.name}</strong> ${hostBadge}
                </div>
                <div style="display: flex; align-items: center;">
                    ${readyBadge}
                    ${kickButtonHtml}
                </div>
            `;
            playerListEl.appendChild(item);
        }

        const kickButtons = playerListEl.querySelectorAll(".btn-kick");
        kickButtons.forEach(btn => {
            btn.addEventListener("click", (e) => {
                const targetId = e.target.getAttribute("data-kick-id");
                if (targetId) {
                    sendWs("kick_player", { targetPlayerId: targetId });
                }
            });
        });

        if (isHost) {
            hostControlsEl.style.display = "block";
            btnStartMatch.style.display = "inline-block";
            selectMode.value = currentLobby.mode_id;
            selectMaps.value = currentLobby.amount_of_map;

            const canStart = (currentLobby.players.length >= 2) && allReady;
            btnStartMatch.disabled = !canStart;
            btnStartMatch.style.opacity = canStart ? "1" : "0.5";
        } else {
            hostControlsEl.style.display = "none";
            btnStartMatch.style.display = "none";
        }

        const myPlayer = currentLobby.players.find(p => p.player_id === localPlayerId);
        if (myPlayer) {
            btnToggleReady.style.display = "block";
            if (myPlayer.ready_status) {
                btnToggleReady.textContent = "UNREADY";
                btnToggleReady.style.background = "#d9534f"; // Red style
                btnToggleReady.style.boxShadow = "0 5px 0 #962d2a";
            } else {
                btnToggleReady.textContent = "READY";
                btnToggleReady.style.background = "#55b02e"; // Green style
                btnToggleReady.style.boxShadow = "0 5px 0 #2b6313";
            }
        }
    }

    function updateResultsHostState() {
        if (!currentLobby) return;
        const isHost = (localPlayerId === currentLobby.host_ID);

        if (isHost) {
            btnPlayAgain.style.display = "inline-block";
            btnReturnToLobby.style.display = "inline-block";
            waitingHostText.style.display = "none";
        } else {
            btnPlayAgain.style.display = "none";
            btnReturnToLobby.style.display = "none";
            waitingHostText.style.display = "block";
        }
        if (btnResultsExitMenu) {
            btnResultsExitMenu.style.display = "inline-block";
        }
    }

    const loadingStatusText = document.getElementById("loading-status-text");

    function updateInventoryUI(itemType) {
        if (!hudInventory) return;
        if (currentLobby && currentLobby.mode_id === "flappy_chained") {
            hudInventory.style.display = "none";
            return;
        }
        hudInventory.style.display = "flex";

        const now = Date.now();
        const cdUntil = window.localItemPickupCooldownUntil || (physics && physics.localItemPickupCooldownUntil);
        const isCooldown = (!itemType && cdUntil && cdUntil > now);
        const itemFabHint = document.getElementById("item-fab-hint");

        if (itemType) {
            hudInventory.classList.add("has-item");
            hudInventory.classList.remove("item-cooldown");
            inventoryEmptyLabel.style.display = "none";
            inventoryItemIcon.style.display = "block";
            const itemMap = {
                ink: "assets/images/items/bucket.png",
                shield: "assets/images/items/Absorption_JE3_BE3.png",
                curse: "assets/images/items/Slowness_JE4.png",
                speed: "assets/images/items/SpeedBoost.png",
                swap: "assets/images/items/swap.png",
                deathnote: "assets/images/items/DeathNote.webp",
                ice: "assets/images/items/ice.png"
            };
            inventoryItemIcon.src = itemMap[itemType] || `assets/images/items/item_${itemType}.svg`;
            if (itemFabHint) itemFabHint.innerText = "TAP TO USE";
        } else if (isCooldown) {
            hudInventory.classList.remove("has-item");
            hudInventory.classList.add("item-cooldown");
            inventoryItemIcon.style.display = "none";
            inventoryEmptyLabel.style.display = "inline";
            const remainingSec = Math.max(0.1, ((cdUntil - now) / 1000)).toFixed(1);
            inventoryEmptyLabel.innerText = `CD ${remainingSec}s`;
            if (itemFabHint) itemFabHint.innerText = "COOLDOWN";
        } else {
            hudInventory.classList.remove("has-item");
            hudInventory.classList.remove("item-cooldown");
            inventoryItemIcon.style.display = "none";
            inventoryEmptyLabel.style.display = "inline";
            inventoryEmptyLabel.innerText = "ITEM";
            if (itemFabHint) itemFabHint.innerText = "TAP TO USE";
        }
    }

    function updateDashUI() {
        if (!hudDash) return;
        const now = Date.now();
        const cdUntil = physics && physics.localDashCooldownUntil;
        if (cdUntil && cdUntil > now) {
            hudDash.classList.add("dash-cooldown");
            if (dashCooldownOverlay) {
                const remainingSec = Math.max(0.1, ((cdUntil - now) / 1000)).toFixed(1);
                dashCooldownOverlay.innerText = `${remainingSec}s`;
            }
            if (dashFabHint) dashFabHint.innerText = "COOLDOWN";
        } else {
            hudDash.classList.remove("dash-cooldown");
            if (dashCooldownOverlay) dashCooldownOverlay.innerText = "";
            if (dashFabHint) dashFabHint.innerText = "SHIFT / D";
        }
    }

    // In-Game Jump, Dash & Item Input Listeners
    function handleJumpInput() {
        if (!gameLoopRunning) return;
        if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "SELECT")) {
            return;
        }
        const input = physics.handleLocalJump();
        if (!input) return;
        audioManager.playSFX("wing");
        if (!window.isRankMode) {
            sendWs("player_input", input);
        }
    }

    function handleDashInput() {
        if (!gameLoopRunning) return;
        if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "SELECT")) {
            return;
        }
        const input = physics.handleLocalDash();
        if (!input) return;

        audioManager.playSFX("swooshing");
        if (renderer && typeof renderer.triggerDashEffect === "function") {
            renderer.triggerDashEffect(physics.predictedState.x, physics.predictedState.y, window.playerSkinId || 0, true);
        }

        if (!window.isRankMode) {
            sendWs("player_input", input);
            sendWs("player_dash");
        }
        updateDashUI();
    }

    function handleUseItemInput() {
        if (currentLobby && currentLobby.mode_id === "flappy_chained") return;
        if (gameLoopRunning && physics.localHeldItem) {
            sendWs("use_item");
        }
    }

    // Keyboard Shortcuts (Desktop Controls)
    window.addEventListener("keydown", (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName : "";
        if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;

        if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyX") {
            handleJumpInput();
        }

        if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyD" || e.key === "d" || e.key === "D" || e.code === "KeyE" || e.key === "e" || e.key === "E") {
            e.preventDefault();
            handleDashInput();
        }

        if (e.code === "KeyF" || e.key === "f" || e.key === "F") {
            e.preventDefault();
            handleUseItemInput();
        }
    });

    // Helper: Determine if an event target is an interactive UI control
    function isInteractiveTarget(target) {
        if (!target) return false;
        return !!target.closest("#hud-inventory, #hud-dash, #inventory-slot, #dash-slot, #btn-item-action, #btn-in-game-exit, .modal, #network-indicator, #network-debug-panel, button, input, select, textarea");
    }

    // Global Screen Tap / Click to Flap (Mobile & Desktop)
    const screenGameEl = screens.gameView;
    let lastGlobalJumpTime = 0;

    function handleGlobalTap(e) {
        if (!gameLoopRunning) return;
        if (isInteractiveTarget(e.target)) return;

        // Only left mouse clicks or touches
        if (e.button !== undefined && e.button !== 0) return;

        // Debounce touch/mouse synthesized event duplicates within 80ms
        const now = performance.now();
        if (now - lastGlobalJumpTime < 80) return;
        lastGlobalJumpTime = now;

        handleJumpInput();
    }

    // Pointerdown on game screen triggers global flap anywhere on screen
    screenGameEl.addEventListener("pointerdown", handleGlobalTap);

    // Floating Action Item Button Touch / Click Listener
    if (hudInventory) {
        hudInventory.addEventListener("pointerdown", (e) => {
            // Stop propagation to prevent global jump
            e.stopPropagation();
        });

        hudInventory.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleUseItemInput();
        });
    }

    // Floating Action Dash Button Touch / Click Listener
    if (hudDash) {
        hudDash.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
        });

        hudDash.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleDashInput();
        });
    }

    // 60 FPS Client Game Render & Prediction Loop
    function startGameLoop() {
        applyResponsiveLayout();
        gameLoopRunning = true;

        function step(now) {
            if (!gameLoopRunning) return;

            physics.updateLocalPhysics();

            if (window.isRankMode) {
                if (checkRankCollisions()) {
                    handleRankGameOver();
                    return;
                }
                checkRankScoring();
                checkRankPipeStream();
            } else {
                physics.updateRemotePlayers();
                if (!physics.localHeldItem && (window.localItemPickupCooldownUntil || physics.localItemPickupCooldownUntil)) {
                    updateInventoryUI(null);
                }
                updateDashUI();
            }

            renderer.render(now);

            animationFrameId = requestAnimationFrame(step);
        }

        animationFrameId = requestAnimationFrame(step);
    }

    function stopGameLoop() {
        gameLoopRunning = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    // CENTRALIZED NATIVE WEBSOCKET MESSAGE DISPATCHER
    function handleSocketMessage(eventOrMsg) {
        let msg;
        if (eventOrMsg && eventOrMsg.type && eventOrMsg.data !== undefined && typeof eventOrMsg.data !== "string") {
            msg = eventOrMsg;
        } else if (eventOrMsg && eventOrMsg.data) {
            try {
                msg = typeof eventOrMsg.data === "string" ? JSON.parse(eventOrMsg.data) : eventOrMsg.data;
            } catch (err) {
                console.error("[WebSocket] Failed to parse message:", err);
                return;
            }
        } else {
            msg = eventOrMsg || {};
        }

        const { type, data = {} } = msg;

        switch (type) {
            case "receive_chat_message": {
                const safeName = escapeHtml(data.senderName);
                const safeMsg = escapeHtml(data.message);
                const htmlLine = `<div class="chat-msg-line"><span class="chat-author">${safeName}:</span> ${safeMsg}</div>`;

                if (lobbyChatMessages) lobbyChatMessages.insertAdjacentHTML("beforeend", htmlLine);
                if (resultsChatMessages) resultsChatMessages.insertAdjacentHTML("beforeend", htmlLine);

                if (lobbyChatMessages) lobbyChatMessages.scrollTop = lobbyChatMessages.scrollHeight;
                if (resultsChatMessages) resultsChatMessages.scrollTop = resultsChatMessages.scrollHeight;
                break;
            }

            case "lobby_created":
            case "lobby_joined": {
                clearLocalPlayerState();
                currentLobby = data.lobby;
                localPlayerId = data.playerId;
                physics.setLocalPlayerId(localPlayerId);
                updateLobbyUI();
                showScreen("lobbyRoom");
                break;
            }

            case "lobby_updated": {
                currentLobby = data.lobby;
                updateLobbyUI();
                updateResultsHostState();
                break;
            }

            case "left_lobby": {
                currentLobby = null;
                clearLocalPlayerState();
                showScreen("mainMenu");
                break;
            }

            case "player_kicked": {
                currentLobby = null;
                clearLocalPlayerState();
                alert(data.message || "You have been kicked from the lobby.");
                showScreen("mainMenu");
                break;
            }

            case "error_message": {
                alert(data.message);
                break;
            }

            case "match_loading": {
                stopGameLoop();
                currentLobby = data.lobby;
                showScreen("loadingScreen");
                renderer.setGameData(data.maps, data.checkpoints, data.itemBoxes, data.finishLineX, currentLobby.mode_id);

                if (loadingStatusText) {
                    loadingStatusText.textContent = `Waiting for players... (${data.readyCount}/${data.totalPlayers} Ready)`;
                }

                sendWs("client_ready");
                break;
            }

            case "loading_progress": {
                if (loadingStatusText) {
                    loadingStatusText.textContent = `Waiting for players... (${data.readyCount}/${data.totalPlayers} Ready)`;
                }
                break;
            }

            case "kicked": {
                stopGameLoop();
                currentLobby = null;
                clearLocalPlayerState();
                showScreen("mainMenu");
                alert(data.message || "You have been kicked from the room.");
                break;
            }

            case "match_starting": {
                currentLobby = data.lobby;
                showScreen("gameView");

                renderer.setGameData(data.maps, data.checkpoints, data.itemBoxes, data.finishLineX, currentLobby.mode_id);

                const startChk = data.checkpoints.find(c => c.checkpoint_id === data.lobby.startCheckpointId);
                const startX = startChk ? startChk.respawn_coordinate_x : 100;
                const startY = startChk ? startChk.respawn_coordinate_y : 320;

                let myChainIdx = 0;
                if (currentLobby && currentLobby.players) {
                    const myPlayer = currentLobby.players.find(p => p.player_id === localPlayerId);
                    if (myPlayer && myPlayer.chain_index !== undefined) {
                        myChainIdx = myPlayer.chain_index;
                    }
                }
                const chainedOffset = (currentLobby.mode_id === "flappy_chained") ? (myChainIdx * 60) : 0;

                physics.resetLocalState(startX - chainedOffset, startY);
                window.localItemPickupCooldownUntil = null;
                physics.isFrozen = true;

                if (currentLobby && currentLobby.mode_id === "flappy_chained") {
                    if (hudInventory) hudInventory.style.display = "none";
                    if (hudDash) hudDash.style.display = "flex";
                } else if (currentLobby && currentLobby.mode_id === "flappy_race") {
                    if (hudInventory) hudInventory.style.display = "flex";
                    if (hudDash) hudDash.style.display = "none";
                } else {
                    if (hudInventory) hudInventory.style.display = "none";
                    if (hudDash) hudDash.style.display = "none";
                }

                startGameLoop();

                let count = data.countdownSeconds || 3;
                startCountdownEl.style.display = "block";
                startCountdownEl.textContent = count;

                const timer = setInterval(() => {
                    count--;
                    if (count > 0) {
                        startCountdownEl.textContent = count;
                    } else if (count === 0) {
                        startCountdownEl.textContent = "GO!";
                        physics.isFrozen = false;
                        physics.predictedState.velocityY = 0;
                    } else {
                        clearInterval(timer);
                        startCountdownEl.style.display = "none";
                        physics.isFrozen = false;
                        physics.predictedState.velocityY = 0;
                    }
                }, 1000);
                break;
            }

            case "game_snapshot": {
                physics.reconcileServerSnapshot(data);
                updateInventoryUI(physics.localHeldItem);

                if (data.finishCountdown !== null && data.finishCountdown >= 0) {
                    finishTimerBanner.style.display = "block";
                    finishTimerSecondsEl.textContent = data.finishCountdown;
                } else {
                    finishTimerBanner.style.display = "none";
                }
                break;
            }

            case "chained_wipeout": {
                audioManager.playSFX("hit");
                audioManager.playSFX("die");
                if (renderer && typeof renderer.triggerDeathEffect === "function") {
                    renderer.triggerDeathEffect(physics.predictedState.x, physics.predictedState.y, true, "WIPEOUT!");
                    physics.remotePlayers.forEach((rp) => {
                        renderer.triggerDeathEffect(rp.x, rp.y, false, "WIPEOUT!");
                    });
                }
                break;
            }

            case "item_collected": {
                audioManager.playSFX("point");
                if (data.playerId === localPlayerId) {
                    if (!data.instant && (!currentLobby || currentLobby.mode_id !== "flappy_chained")) {
                        physics.localHeldItem = data.acquiredItem || null;
                    } else {
                        physics.localHeldItem = null;
                    }
                    window.localItemPickupCooldownUntil = data.pickupCooldownUntil || (Date.now() + 3000);
                    physics.localItemPickupCooldownUntil = window.localItemPickupCooldownUntil;
                    updateInventoryUI(physics.localHeldItem);
                }
                if (renderer && renderer.itemBoxes) {
                    const targetBox = renderer.itemBoxes.find(b => b.id === data.itemId);
                    if (targetBox) {
                        targetBox.collected = true;
                        targetBox.isActive = false;
                        if (typeof renderer.triggerItemBoxCollectEffect === "function") {
                            renderer.triggerItemBoxCollectEffect(targetBox.x, targetBox.y, data.acquiredItem, data.playerId === localPlayerId);
                        }
                    }
                }
                break;
            }

            case "item_respawned": {
                if (renderer && renderer.itemBoxes && data && data.itemId) {
                    const targetBox = renderer.itemBoxes.find(b => b.id === data.itemId);
                    if (targetBox) {
                        targetBox.collected = false;
                        targetBox.isActive = true;
                    }
                }
                break;
            }

            case "shield_expired": {
                let targetX = null;
                let targetY = null;
                if (data && data.playerId === localPlayerId) {
                    physics.localHasShield = false;
                    targetX = physics.predictedState.x;
                    targetY = physics.predictedState.y;
                }
                if (physics.remotePlayers.has(data.playerId)) {
                    const rp = physics.remotePlayers.get(data.playerId);
                    rp.hasShield = false;
                    targetX = rp.x;
                    targetY = rp.y;
                }
                if (renderer && typeof renderer.triggerShieldBreakEffect === "function" && targetX !== null && targetY !== null) {
                    renderer.triggerShieldBreakEffect(targetX, targetY);
                }
                break;
            }

            case "invincibility_expired": {
                if (data && data.playerId === localPlayerId) {
                    physics.localIsInvincible = false;
                }
                if (physics.remotePlayers.has(data.playerId)) {
                    physics.remotePlayers.get(data.playerId).isInvincible = false;
                }
                break;
            }

            case "player_dashed": {
                if (!data) break;
                if (data.playerId !== localPlayerId) {
                    const rp = physics.remotePlayers.get(data.playerId);
                    if (rp) {
                        rp.x = data.x;
                        rp.y = data.y;
                        rp.dashCooldownUntil = data.dashCooldownUntil;
                        if (renderer && typeof renderer.triggerDashEffect === "function") {
                            renderer.triggerDashEffect(data.x, data.y, rp.skin_ID || 0, false);
                        }
                    }
                } else {
                    if (data.dashCooldownUntil) {
                        physics.localDashCooldownUntil = data.dashCooldownUntil;
                        updateDashUI();
                    }
                }
                break;
            }

            case "item_used": {
                try {
                    if (!data) break;

                    if (data.userId === localPlayerId) {
                        physics.localHeldItem = null;
                        updateInventoryUI(null);
                    }

                    if (data.wasted) {
                        addActivityFeedLog(`<span style="color: #f7d51d;">${escapeHtml(data.userName)}</span> used ${(data.itemType || "ITEM").toUpperCase()} <span style="color: #888;">(WASTED)</span>`);
                    } else if (data.shieldBlocked) {
                        addActivityFeedLog(`<span style="color: #55b02e;">${escapeHtml(data.targetName)}</span>'s SHIELD blocked <span style="color: #f7d51d;">${escapeHtml(data.userName)}</span>'s ${(data.itemType || "ITEM").toUpperCase()}`);
                        if (renderer && typeof renderer.triggerShieldBreakEffect === "function") {
                            let tx = null, ty = null;
                            if (data.targetId === localPlayerId) {
                                tx = physics.predictedState.x;
                                ty = physics.predictedState.y;
                            } else if (physics.remotePlayers.has(data.targetId)) {
                                const rp = physics.remotePlayers.get(data.targetId);
                                tx = rp.x;
                                ty = rp.y;
                            }
                            if (tx !== null && ty !== null) {
                                renderer.triggerShieldBreakEffect(tx, ty);
                            }
                        }
                    } else {
                        const userStr = `<span style="color: #f7d51d;">${escapeHtml(data.userName)}</span>`;
                        const targetStr = `<span style="color: #ffffff;">${escapeHtml(data.targetName || "Target")}</span>`;

                        if (data.instant) {
                            if (data.itemType === "speed") {
                                addActivityFeedLog(`🎲 ${userStr} hit Lucky Block: <span style="color: #55b02e; font-weight: bold;">TURBO BOOST!</span> ⚡`);
                            } else if (data.itemType === "shield") {
                                addActivityFeedLog(`🎲 ${userStr} hit Lucky Block: <span style="color: #3993d0; font-weight: bold;">SHIELD BARRIER!</span> 🛡️`);
                            } else if (data.itemType === "swap") {
                                addActivityFeedLog(`🎲 ${userStr} hit Lucky Block: <span style="color: #ff007f; font-weight: bold;">CHAOS POSITION SWAP!</span> 🌀`);
                                audioManager.playSFX("swooshing");
                                if (renderer && typeof renderer.triggerChaosSwapEffect === "function") {
                                    renderer.triggerChaosSwapEffect(data.swappedPlayers);
                                }
                                if (data.swappedPlayers) {
                                    const mySwap = data.swappedPlayers.find(sp => sp.playerId === localPlayerId);
                                    if (mySwap) {
                                        physics.predictedState.x = mySwap.x;
                                        physics.predictedState.y = mySwap.y;
                                        physics.predictedState.velocityY = 0;
                                        physics.pendingInputs = [];
                                    }
                                }
                            } else if (data.itemType === "ink") {
                                addActivityFeedLog(`🎲 ${userStr} hit Lucky Block: <span style="color: #e07629; font-weight: bold;">BUCKET HEAD</span> on ${targetStr}! 🪣`);
                                if (data.targetId === localPlayerId) {
                                    window.localInkUntil = Date.now() + (data.duration || 5000);
                                    audioManager.playSFX("swooshing");
                                }
                            } else if (data.itemType === "curse") {
                                addActivityFeedLog(`🎲 ${userStr} hit Lucky Block: <span style="color: #d9534f; font-weight: bold;">CURSED</span> ${targetStr} [SLOW]! ⛓️`);
                                if (data.targetId === localPlayerId) audioManager.playSFX("hit");
                            } else if (data.itemType === "ice") {
                                addActivityFeedLog(`🎲 ${userStr} hit Lucky Block: <span style="color: #70c5ce; font-weight: bold;">FROZE</span> ${targetStr} in ICE! ❄️`);
                            }
                        } else {
                            if (data.itemType === "speed") {
                                addActivityFeedLog(`${userStr} activated <span style="color: #55b02e;">SPEED BOOST</span>`);
                            } else if (data.itemType === "shield") {
                                addActivityFeedLog(`${userStr} activated <span style="color: #3993d0;">SHIELD</span>`);
                            } else if (data.itemType === "swap") {
                                if (data.isChaosSwap) {
                                    addActivityFeedLog(`${userStr} triggered <span style="color: #ff007f; font-weight: bold;">CHAOS POSITION SWAP!</span> 🌀`);
                                    audioManager.playSFX("swooshing");
                                    if (renderer && typeof renderer.triggerChaosSwapEffect === "function") {
                                        renderer.triggerChaosSwapEffect(data.swappedPlayers);
                                    }
                                    if (data.swappedPlayers) {
                                        const mySwap = data.swappedPlayers.find(sp => sp.playerId === localPlayerId);
                                        if (mySwap) {
                                            physics.predictedState.x = mySwap.x;
                                            physics.predictedState.y = mySwap.y;
                                            physics.predictedState.velocityY = 0;
                                            physics.pendingInputs = [];
                                        }
                                    }
                                } else {
                                    addActivityFeedLog(`${userStr} <span style="color: #f7d51d;">SWAPPED</span> position with ${targetStr}`);
                                    if (renderer && typeof renderer.triggerSwapEffect === "function") {
                                        let uX = 0, uY = 0, tX = 0, tY = 0;
                                        if (data.userId === localPlayerId) {
                                            uX = physics.predictedState.x;
                                            uY = physics.predictedState.y;
                                        } else if (physics.remotePlayers.has(data.userId)) {
                                            const rp = physics.remotePlayers.get(data.userId);
                                            uX = rp.x;
                                            uY = rp.y;
                                        }
                                        if (data.targetId === localPlayerId) {
                                            tX = physics.predictedState.x;
                                            tY = physics.predictedState.y;
                                        } else if (physics.remotePlayers.has(data.targetId)) {
                                            const rp = physics.remotePlayers.get(data.targetId);
                                            tX = rp.x;
                                            tY = rp.y;
                                        }
                                        renderer.triggerSwapEffect(uX, uY, tX, tY, data.userName, data.targetName);
                                    }
                                }
                            } else if (data.itemType === "ink") {
                                addActivityFeedLog(`${userStr} used <span style="color: #e07629;">BUCKET</span> on ${targetStr}`);
                                if (data.targetId === localPlayerId) {
                                    window.localInkUntil = Date.now() + (data.duration || 5000);
                                    audioManager.playSFX("swooshing");
                                }
                            } else if (data.itemType === "curse") {
                                addActivityFeedLog(`${userStr} CURSED ${targetStr} <span style="color: #d9534f;">[SLOW]</span>`);
                                if (data.targetId === localPlayerId) audioManager.playSFX("hit");
                            } else if (data.itemType === "deathnote") {
                                addActivityFeedLog(`${userStr} used <span style="color: #d9534f;">DEATH NOTE</span> on ${targetStr}`);
                                if (data.userId === localPlayerId) {
                                    // Attacker who used Death Note does NOT get any screen overlay
                                    window.deathnoteEffectUntil = 0;
                                    window.deathnoteBannerText = "";
                                    window.deathnoteSubText = "";
                                }
                                if (renderer && typeof renderer.triggerDeathEffect === "function") {
                                    let targetX = 0, targetY = 0;
                                    const isLocalTarget = (data.targetId === localPlayerId);
                                    if (isLocalTarget) {
                                        targetX = physics.predictedState.x;
                                        targetY = physics.predictedState.y;
                                    } else if (physics.remotePlayers.has(data.targetId)) {
                                        const rp = physics.remotePlayers.get(data.targetId);
                                        targetX = rp.x;
                                        targetY = rp.y;
                                    }
                                    if (targetX || targetY) {
                                        renderer.triggerDeathEffect(targetX, targetY, isLocalTarget, "DEATH NOTE!");
                                    }
                                }
                            } else if (data.itemType === "ice") {
                                addActivityFeedLog(`${userStr} <span style="color: #70c5ce;">FROZE</span> ${targetStr} in ICE`);
                            }
                        }
                    }

                    if (data.shieldBlocked && data.targetId === localPlayerId) {
                        audioManager.playSFX("point");
                        physics.localHasShield = false;
                        if (data.invincible) {
                            physics.localIsInvincible = true;
                        }
                    }
                } catch (err) {
                    console.warn("[Client] Safely handled item_used listener error:", err);
                }
                break;
            }

            case "deathnote_announcement": {
                if (!data) break;
                // Only show screen overlay and hit sound on the target who was struck!
                // The user who used it and all other players will NOT have anything appear on their screen.
                const isTarget = (data.targetId && data.targetId === localPlayerId) || 
                                 (!data.targetId && (
                                     (physics && physics.localPlayerId === data.targetId) ||
                                     (currentLobby && currentLobby.players && currentLobby.players.find(p => p.player_id === localPlayerId)?.name === data.targetName)
                                 ));

                if (isTarget) {
                    audioManager.playSFX("hit");
                    window.deathnoteEffectUntil = Date.now() + 2500;
                    window.deathnoteBannerText = `${data.targetName} STRUCK BY DEATH NOTE!`;
                    window.deathnoteSubText = `USED BY ${data.attackerName || "AN OPPONENT"}`;
                } else {
                    window.deathnoteEffectUntil = 0;
                    window.deathnoteBannerText = "";
                    window.deathnoteSubText = "";
                }
                break;
            }

            case "player_knocked_down": {
                if (!data) break;
                const isLocal = (data.playerId === localPlayerId);
                if (isLocal) {
                    audioManager.playSFX("hit");
                    physics.triggerKnockdown(data.x, data.y, data.knockdownDurationMs || 5000);
                    if (renderer && typeof renderer.triggerKnockdownEffect === "function") {
                        renderer.triggerKnockdownEffect(data.x || physics.predictedState.x, data.y || physics.predictedState.y, true);
                    }
                    addActivityFeedLog(`<span style="color: #d9534f;">YOU</span> got KNOCKED DOWN! (5s)`);
                } else {
                    if (physics.remotePlayers.has(data.playerId)) {
                        physics.triggerRemoteKnockdown(data.playerId, data.x, data.y, data.knockdownDurationMs || 5000);
                        const rp = physics.remotePlayers.get(data.playerId);
                        if (renderer && typeof renderer.triggerKnockdownEffect === "function") {
                            renderer.triggerKnockdownEffect(data.x || rp.x, data.y || rp.y, false);
                        }
                        addActivityFeedLog(`<span style="color: #ffffff;">${escapeHtml(rp.name)}</span> got KNOCKED DOWN!`);
                    }
                }
                break;
            }

            case "player_ready_to_fly": {
                if (!data) break;
                const isLocal = (data.playerId === localPlayerId);
                if (isLocal) {
                    physics.localIsReadyToFly = true;
                    audioManager.playSFX("point");
                    addActivityFeedLog(`<span style="color: #55b02e;">READY TO FLY!</span> Tap to flap!`);
                } else {
                    if (physics.remotePlayers.has(data.playerId)) {
                        const rp = physics.remotePlayers.get(data.playerId);
                        rp.isReadyToFly = true;
                    }
                }
                break;
            }

            case "player_recovered": {
                if (!data) break;
                const isLocal = (data.playerId === localPlayerId);
                if (isLocal) {
                    physics.localIsKnockedDown = false;
                    physics.localIsReadyToFly = false;
                    physics.localKnockdownUntil = null;
                    physics.localIsInvincible = true;
                    physics.localInvincibleUntil = Date.now() + (data.invincibleMs || 4000);
                    audioManager.playSFX("wing");
                    addActivityFeedLog(`<span style="color: #f7d51d;">YOU</span> RECOVERED! <span style="color: #55b02e;">[4s Shield]</span>`);
                } else {
                    if (physics.remotePlayers.has(data.playerId)) {
                        const rp = physics.remotePlayers.get(data.playerId);
                        rp.isKnockedDown = false;
                        rp.isReadyToFly = false;
                        rp.knockdownUntil = null;
                        rp.isInvincible = true;
                        rp.invincibleUntil = Date.now() + (data.invincibleMs || 4000);
                        addActivityFeedLog(`<span style="color: #ffffff;">${escapeHtml(rp.name)}</span> RECOVERED! [4s Shield]`);
                    }
                }
                break;
            }

            case "player_respawned": {
                const isLocal = (data.playerId === localPlayerId);
                if (isLocal) {
                    audioManager.playSFX("hit");
                    physics.predictedState.x = data.x;
                    physics.predictedState.y = data.y;
                    physics.predictedState.velocityY = 0;
                }
                if (renderer && typeof renderer.triggerDeathEffect === "function") {
                    renderer.triggerDeathEffect(data.x, data.y, isLocal, "CRASH!");
                }
                break;
            }

            case "match_finished": {
                stopGameLoop();
                finishTimerBanner.style.display = "none";
                showScreen("resultsView");

                updateResultsHostState();

                const isChainedMode = (data.mode_id === "flappy_chained");

                if (isChainedMode) {
                    resultsMainHeader.textContent = "FLAPPY CHAINED RESULTS";
                    resultsSubHeader.style.display = "block";
                    resultsSubHeader.textContent = `TEAM TOTAL TIME: ${data.team_total_time || "00:00.00"}`;

                    leaderboardHead.innerHTML = `
                        <tr>
                            <th>PLAYER</th>
                            <th>WIPES CAUSED</th>
                            <th>STATUS</th>
                        </tr>
                    `;

                    leaderboardBody.innerHTML = "";
                    for (let entry of data.leaderboard) {
                        const tr = document.createElement("tr");
                        tr.innerHTML = `
                            <td><strong>${escapeHtml(entry.name)}</strong></td>
                            <td><span style="color: #d9534f; font-weight: bold;">Wipes Caused: ${entry.wipes_caused || 0}</span></td>
                            <td><span class="status-finished">COMPLETED</span></td>
                        `;
                        leaderboardBody.appendChild(tr);
                    }
                } else {
                    resultsMainHeader.textContent = "MATCH RESULTS";
                    resultsSubHeader.style.display = "none";

                    leaderboardHead.innerHTML = `
                        <tr>
                            <th>RANK</th>
                            <th>PLAYER</th>
                            <th>TIME / STATUS</th>
                        </tr>
                    `;

                    leaderboardBody.innerHTML = "";
                    for (let entry of data.leaderboard) {
                        const tr = document.createElement("tr");

                        const rankDisplay = entry.ranking ? `#${entry.ranking}` : "-";
                        const statusDisplay = entry.finish_time 
                            ? `<span class="status-finished">${entry.finish_time}</span>`
                            : `<span class="status-out">${entry.status_text}</span>`;

                        tr.innerHTML = `
                            <td>${rankDisplay}</td>
                            <td><strong>${escapeHtml(entry.name)}</strong></td>
                            <td>${statusDisplay}</td>
                        `;
                        leaderboardBody.appendChild(tr);
                    }
                }
                break;
            }

            case "returned_to_lobby": {
                stopGameLoop();
                currentLobby = data.lobby;
                updateLobbyUI();
                showScreen("lobbyRoom");
                break;
            }

            default:
                console.warn(`[WebSocket] Central router received unknown message type: ${type}`);
        }
    };

    // Network Diagnostics & Simulator UI Bindings
    const netPingDot = document.getElementById("net-ping-dot");
    const netPingText = document.getElementById("net-ping-text");
    const netQualityBadge = document.getElementById("net-quality-badge");
    const btnToggleNetDebug = document.getElementById("btn-toggle-net-debug");
    const netTooltipRtt = document.getElementById("net-tooltip-rtt");
    const netTooltipSrtt = document.getElementById("net-tooltip-srtt");
    const netTooltipMinmax = document.getElementById("net-tooltip-minmax");
    const netTooltipJitter = document.getElementById("net-tooltip-jitter");

    const netDebugPanel = document.getElementById("network-debug-panel");
    const btnCloseNetDebug = document.getElementById("btn-close-net-debug");
    const netSimEnable = document.getElementById("net-sim-enable");
    const sliderNetLatency = document.getElementById("slider-net-latency");
    const sliderNetJitter = document.getElementById("slider-net-jitter");
    const sliderNetDrop = document.getElementById("slider-net-drop");
    const selectNetDirection = document.getElementById("select-net-direction");
    const labelNetLatency = document.getElementById("label-net-latency");
    const labelNetJitter = document.getElementById("label-net-jitter");
    const labelNetDrop = document.getElementById("label-net-drop");
    const netSimStatusText = document.getElementById("net-sim-status-text");
    const btnResetNetSim = document.getElementById("btn-reset-net-sim");

    function updateNetworkIndicatorUI(status) {
        if (!netPingDot || !status) return;
        netPingDot.style.backgroundColor = status.color || "#888";
        if (netPingText) netPingText.textContent = `PING: ${status.rttText}`;
        if (netQualityBadge) {
            netQualityBadge.textContent = status.text;
            netQualityBadge.style.backgroundColor = (status.status === "GOOD") ? "#2b6313" : ((status.status === "FAIR") ? "#9c7c10" : ((status.status === "HIGH") ? "#962d2a" : "#444"));
        }
        if (netTooltipRtt) netTooltipRtt.textContent = status.rtt !== null ? `${status.rtt}ms` : "--";
        if (netTooltipSrtt) netTooltipSrtt.textContent = status.srtt !== null ? `${status.srtt}ms` : "--";
        if (netTooltipMinmax) netTooltipMinmax.textContent = (status.minRtt !== null && status.maxRtt !== null) ? `${status.minRtt}ms / ${status.maxRtt}ms` : "-- / --";
        if (netTooltipJitter) netTooltipJitter.textContent = status.jitter !== null ? `±${status.jitter}ms` : "--";
    }

    function updateSimulatorUI() {
        if (!netSimStatusText) return;
        if (labelNetLatency && sliderNetLatency) labelNetLatency.textContent = `${sliderNetLatency.value} ms`;
        if (labelNetJitter && sliderNetJitter) labelNetJitter.textContent = `${sliderNetJitter.value} ms`;
        if (labelNetDrop && sliderNetDrop) labelNetDrop.textContent = `${sliderNetDrop.value} %`;

        const isEnabled = netSimEnable ? netSimEnable.checked : false;
        const latencyVal = sliderNetLatency ? Number(sliderNetLatency.value) : 0;
        const jitterVal = sliderNetJitter ? Number(sliderNetJitter.value) : 0;
        const dropVal = sliderNetDrop ? Number(sliderNetDrop.value) : 0;
        const dirVal = selectNetDirection ? selectNetDirection.value : "both";

        if (isEnabled && (latencyVal > 0 || jitterVal > 0 || dropVal > 0)) {
            netSimStatusText.textContent = `ACTIVE (${latencyVal}ms ±${jitterVal}ms, ${dropVal}% drop, ${dirVal})`;
            netSimStatusText.style.color = "#f7d51d";
        } else if (isEnabled) {
            netSimStatusText.textContent = "ENABLED (0ms latency, 0% drop)";
            netSimStatusText.style.color = "#f7d51d";
        } else {
            netSimStatusText.textContent = "OFF (PASS-THROUGH)";
            netSimStatusText.style.color = "#74bf2e";
        }

        if (networkSimulator) {
            networkSimulator.setOptions({
                enabled: isEnabled,
                latency: latencyVal,
                jitter: jitterVal,
                dropRate: dropVal,
                direction: dirVal
            });
        }
    }

    // Only reveal simulator controls if ?debug=network is explicitly set in URL
    const isDebugNetwork = urlParams.get("debug") === "network";
    if (isDebugNetwork) {
        if (btnToggleNetDebug) {
            btnToggleNetDebug.style.display = "inline-block";
            btnToggleNetDebug.addEventListener("click", (e) => {
                e.stopPropagation();
                if (netDebugPanel) {
                    netDebugPanel.style.display = (netDebugPanel.style.display === "none") ? "block" : "none";
                }
            });
        }
    } else {
        if (btnToggleNetDebug) btnToggleNetDebug.style.display = "none";
        if (netDebugPanel) netDebugPanel.style.display = "none";
    }

    if (btnCloseNetDebug) {
        btnCloseNetDebug.addEventListener("click", () => {
            if (netDebugPanel) netDebugPanel.style.display = "none";
        });
    }

    if (btnResetNetSim) {
        btnResetNetSim.addEventListener("click", () => {
            if (netSimEnable) netSimEnable.checked = false;
            if (sliderNetLatency) sliderNetLatency.value = 0;
            if (sliderNetJitter) sliderNetJitter.value = 0;
            if (sliderNetDrop) sliderNetDrop.value = 0;
            if (selectNetDirection) selectNetDirection.value = "both";
            if (networkSimulator) networkSimulator.reset();
            updateSimulatorUI();
        });
    }

    [netSimEnable, sliderNetLatency, sliderNetJitter, sliderNetDrop, selectNetDirection].forEach(el => {
        if (el) {
            el.addEventListener("input", updateSimulatorUI);
            el.addEventListener("change", updateSimulatorUI);
        }
    });

    updateSimulatorUI();
    if (pingTracker) updateNetworkIndicatorUI(pingTracker.getStatus());

    updateCustomizationUI();
});
