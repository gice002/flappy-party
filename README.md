# Real-Time Multiplayer Flappy Bird Architecture

An authoritative, real-time multiplayer HTML5 Canvas game built with Node.js, Express, and native WebSockets (`ws`). Engineered with **Client-Side Prediction**, **Ping-Based Remote Player Interpolation**, **60 TPS Fixed Timestep Physics Engine**, **Knockdown & Recovery Mechanics**, **Chained Tether Constraint Physics**, **Instant Lucky Block Traps**, and a decoupled **Vercel Edge Frontend + Cloudflare Tunnel Backend Architecture**.

---

## 🚀 Quick Start Guide: Hosting a Game Session for Friends

Whenever you want to host a multiplayer session from your computer or server:

### Step 1: Start the Local Game Server (Terminal 1)
```bash
npm install
npm start
```
*(Server listens on `http://localhost:3000` with native WebSocket engine enabled)*

### Step 2: Open High-Speed Cloudflare Tunnel (Terminal 2)
```bash
npx cloudflared tunnel --url http://localhost:3000
```
*(Connects to the nearest Cloudflare edge node and generates a public URL, e.g., `https://xxxx.trycloudflare.com`)*

### Step 3: Share the Game Link with Friends
Send players the URL with your Cloudflare tunnel backend parameter attached:

👉 **`https://flappy-blyat.vercel.app/?server=wss://xxxx.trycloudflare.com`**  
*(Replace `xxxx.trycloudflare.com` with your active tunnel subdomain)*

---

## 🛠️ Architecture Overview

```
+-----------------------------------+       +------------------------------------+
|       Vercel Edge Network         |       |   Authoritative Node.js Server     |
| (High-Speed Static Client Host)   |       |   (60 TPS Fixed Timestep Engine)   |
|                                   |       |                                    |
| - client/index.html               |       | - server/server.js                 |
| - client/js/ (app, physics, etc)  |       | - server/game/gameLoop.js          |
| - client/assets/ (PNG, WAV, MP3)  |       | - server/game/lobbyManager.js      |
+-----------------+-----------------+       +-----------------+------------------+
                  |                                           |
                  | Fetches Static Assets (HTTP/2)            | WSS Connection
                  v                                           v (60 Hz Snapshots)
        +---------------------------------------------------------------+
        |                     Player Browser Client                     |
        |  - Client-Side Prediction (0ms Input Latency)                 |
        |  - Remote Player Linear Interpolation (Ping Smoothing)        |
        |  - Dynamic WebSocket Server Auto-Discovery                    |
        |  - Mobile Portrait View with Touch Action HUD Controls        |
        +---------------------------------------------------------------+
```

---

## 🎮 Game Modes

### 1. 🏆 Play Rank (Classic Solo Mode) & Supabase Leaderboard
* **Single-Player Endless Survival**: Classic Flappy Bird gameplay with procedural pipes generated infinitely.
* **Authoritative Supabase Leaderboard**: When the game ends, the score is sent to the backend server directly, which authoritatively writes to a PostgreSQL database on **Supabase** via `@supabase/supabase-js`.
* **Anti-Cheat Physical Sanity Verification**: The backend tracks active rank sessions (`rankManager.js`) and calculates the physical time bounds based on horizontal forward velocity ($160\text{px/s}$) and pipe distance ($220\text{px}$). Impossible spoofed scores are automatically detected and clamped.
* **Hall of Fame (Top 10 Rankings)**: Real-time leaderboard view with player rank medals (🥇 #1, 🥈 #2, 🥉 #3), player names, scores, and timestamps.
* **Graceful In-Memory Fallback**: If Supabase credentials are not set in `.env`, the server automatically runs an in-memory fallback store with zero downtime and seamless functionality.

### 2. 🏁 Flappy Race (Multiplayer PvP)
* **Competitive Speed Race**: 2 to 4 players compete across procedural multi-map themes (e.g. Classic Day, Neon Night, Sunset Dusk, Underwater Realm, Volcano Inferno, Candyland, Snowy Tundra, Desert Dunes).
* **Knockdown & Recovery System**: Hitting a pipe knocks the bird down to the ground for 5 seconds with spinning dizzy stars and impact dust. Once ready, tapping flap launches the bird back into the race with a **4-second invincibility shield** (`#55b02e` green aura).
* **Lucky Blocks & Inventory**: Collect Lucky Block boxes placed in gaps to store items in your inventory, activated manually with `F` (Desktop) or the on-screen action button.

### 3. ⛓️ Flappy Chained (Co-op / Tether Chaos)
* **Dynamic Iron Chain Physics**: All birds are connected by an elastic chain constraint. The chain displays real-time catenary sag when loose, an amber line when taut, and crimson jitter with sparks when subjected to critical strain ($>110\text{px}$).
* **Dash Burst (⚡ DASH)**: Players can trigger an explosive forward boost (`Shift` / `D` / `E` or mobile FAB) with neon afterimages, shockwaves, and a 3.5s live cooldown timer.
* **Fallen Bird Mechanics (นกชนแล้วตกลงพื้น)**: When a bird hits a pipe, it falls to the ground in knockdown state. **The checkpoint system is removed entirely**; the fallen bird anchors the tether or slides along the ground with the flying partner until flapping to recover!
* **Instant Forced Lucky Block Events**: Lucky blocks trigger chaotic effects **IMMEDIATELY** upon collision (no inventory holding):
  * 🌀 **Chaos Position Swap (`swap`)**: Scrambles the physical coordinates of all active players, tangling the chain!
  * 🪣 **Vision Blindness (`ink`)**: Shrouds partner's forward vision in dark radial fog.
  * ❄️ **Ice Freeze (`ice`)**: Freezes partner mid-air into an anchor block for 2.5s.
  * ⛓️ **Slowness Curse (`curse`)**: Reduces partner's speed to 65% for 6s, straining the tether.
  * ⚡ **Turbo Boost (`speed`)**: Surges forward at 150% speed for 4s, dragging the partner along.
  * 🛡️ **Barrier Shield (`shield`)**: Grants an energy shield blocking the next incoming hazard.

### 4. 👹 Flappy Boss (3 Bosses Co-op Raid)
* **Stage Layout & Fixed-Position Flight**:
  * Giant animated boss entity anchored on the right side of the screen ($X \approx 270$).
  * **No pipes**: The stage consists entirely of open skies, the boss, projectile hazards, and collectible energy orbs.
  * **Fixed-Position Movement**: Players fly up and down in a fixed horizontal slot ($X \approx 60 - 135$) purely to dodge attacks.
  * **Dynamic Boss Backgrounds**: Smooth real-time background shader cross-fading tailored to each boss (`volcano` -> `snowy` -> `city_night`).
* **3 Sequential Bosses & HP Scaling**:
  1. **Ignis the Fire Wyrm (Boss 1)**: Volcano inferno theme. Base HP: 100. Attacks: Magma fireballs and horizontal spread waves.
  2. **Glacius the Frost Titan (Boss 2)**: Snowy tundra theme. Base HP: 150. Attacks: Piercing ice shards and high-energy frost laser beams preceded by 1.2s telegraph hazard warning lines.
  3. **Malakor the Void Overlord (Boss 3)**: City night neon theme. Base HP: 200. Attacks: Dual void laser beams and tracking void vortex spheres.
  * **Dynamic Player HP Scaling**: Boss HP multiplies by the number of players ($HP = \text{baseHp} \times \text{playerCount}$).
* **Player Attack System**:
  * Periodically spawns glowing collectible Energy Orbs across the dodge zone.
  * Flying to touch an orb fires an energy blast dealing **25 damage** directly to the boss.
* **Lives, Knockdown & Revival System**:
  * Each player starts with **2 lives** per boss.
  * **1st Hit**: Knocks the bird down to the ground for 5 seconds with dazed stars and impact dust. Tap flap after 5s to recover with a 4s invincibility shield.
  * **2nd Hit**: Player falls in battle (`💀 DEAD`), lying on the ground waiting for the team to finish the boss.
  * **Boss Defeat & Teammate Revival**: Defeating a boss immediately revives all fallen teammates with full 2 lives restored!
  * **5-Second Intermission**: 5-second rest and preparation countdown before the next boss descends.
  * **Team Wipeout**: If all players lose all lives, the raid ends in defeat.
* **Stage Conclusion & Economy Rewards**:
  * Slaying Boss 3 transitions into a celebratory **Victory Run** flying forward into the Golden Finish Line!
  * Awards **+75 Coins** into the Supabase Wallet for a full clear, or +25 to +45 coins on partial boss clears.

---

## 🎁 Power-Ups & Item Registry

| Item | Effect | Activation | Icon Asset |
|---|---|---|---|
| **Lucky Block** | Mystery gold box spawning at pipe gaps; includes 3s anti-vertical-spam cooldown | Contact | `lucky_block.png` |
| **Position Swap** | Swaps physical positions with opponent (Race) or scrambles all players (Chained) | Manual / Instant | `swap.png` |
| **Vision Blindness** | Deep radial fog obscuring forward vision of upcoming pipes for 5s | Target / Partner | `bucket.png` |
| **Absorption Shield** | Blocks one hostile debuff; grants 3s invincibility post-block | Collector | `Absorption_JE3_BE3.png` |
| **Speed Boost** | Increases forward movement speed by 50% for 4s with cyan afterimages | Collector | `SpeedBoost.png` |
| **Ice Freeze** | Freezes target mid-air into a solid ice block for 2.5s | Target / Partner | `ice.png` |
| **Slowness Curse** | Reduces forward flight velocity by 35% for 6s | Target / Partner | `Slowness_JE4.png` |
| **Death Note** | Strikes the 1st place opponent with knockdown impact and targeted overlay | Target (Race) | `DeathNote.webp` |

---

## ⌨️ Game Controls

| Action | Desktop Controls | Mobile / Touch Controls |
|---|---|---|
| **Flap / Jump** | `Space` / `ArrowUp` / `KeyX` / Left Click | Tap anywhere on screen |
| **Dash Burst (Chained)** | `Shift` / `KeyD` / `KeyE` | Tap `⚡ DASH` button |
| **Use Item (Race)** | `KeyF` | Tap `ITEM` button |
| **Leave Match** | `Esc` / Top-right `✕ LEAVE` button | Tap `✕ LEAVE` button |

---

## 📁 Project Structure

```
flappy-bird/
├── client/
│   ├── assets/                # Audio SFX/BGM, backgrounds, hats, pipes, items
│   │   ├── backgrounds/       # Multi-theme map backdrops
│   │   ├── hats/              # Custom cosmetics (Crown, Top Hat, Viking, Cap)
│   │   ├── items/             # Lucky Block, Swap, Shield, Speed, Slowness, Ice, etc.
│   │   └── pipes/             # Theme-matched top and bottom pipe pairs
│   ├── config/
│   │   └── assets.json        # Centralized theme and asset registry
│   ├── css/
│   │   ├── style.css          # Pixel-art HUD, portrait responsive FABs, lobby UI
│   │   └── flappybird.css     # Game canvas container layouts
│   ├── js/
│   │   ├── app.js             # UI router, WebSocket messaging, sound & action HUD
│   │   ├── audio.js           # Multi-channel Web Audio SFX and BGM system
│   │   ├── physics.js         # Client-side prediction, lerp interpolation & local tether
│   │   ├── renderer.js        # Canvas visual effects, chain solver, afterimages, particles
│   │   └── ui.js              # Lobby, customization, and settings modal manager
│   └── index.html             # HTML5 Mobile Portrait View entry point
├── server/
│   ├── config/
│   │   └── constants.js       # Physics parameters, cooldowns, and duration constants
│   ├── db/
│   │   └── schema.sql         # Supabase PostgreSQL schema with table, index, RLS & seed
│   ├── game/
│   │   ├── gameLoop.js        # 60 TPS authoritative loop, knockdown & tether solver
│   │   ├── lobbyManager.js    # Rooms, ready-checks, mode routing, match lifecycle
│   │   ├── mapGenerator.js    # Procedural map themes, pipes & item box generator
│   │   └── rankManager.js     # Authoritative rank sessions & anti-cheat validator
│   ├── models/                # Player, Lobby, Leaderboard, Map, Checkpoint entities
│   ├── services/
│   │   └── supabaseClient.js  # Supabase client connector with fallback resilient cache
│   ├── sockets/
│   │   └── socketHandler.js   # Native WebSocket dispatcher and 15s heartbeat
│   └── server.js              # Express HTTP server, REST endpoints & WebSocket listener
├── references/                # UI mockups, design specifications & archives
├── scratch/                   # Automated unit test suites (100% test coverage)
│   ├── test-supabase-leaderboard.js  # Supabase & authoritative rank mode test suite
│   ├── test-chained-mode-upgrade.js  # Chained tether & instant items test suite
│   ├── test-pickup-cooldown.js       # 3-second Lucky Block pickup cooldown test suite
│   └── test-new-items.js             # Speed, Swap, Death Note, Ice tests
├── Dockerfile                 # Multi-stage production container setup
├── fly.toml                   # Fly.io deployment template
├── package.json               # Node.js dependencies and scripts
├── vercel.json                # Vercel static output configuration
└── README.md                  # Project documentation
```

---

## 💰 Game Economy, Wallet & Hat Shop System

An authoritative, server-driven game economy integrated with **Supabase PostgreSQL**. Players earn coins by proving their skills across all game modes, which are stored in their persistent **Wallet** and can be spent in the **Hat Shop & Customization** lounge.

### 1. 🗄️ 5 Core Database Tables in Supabase
All 5 tables are defined with UUID primary keys, foreign key constraints, Row Level Security (RLS) policies, and performance indexes in [`server/db/economy_schema.sql`](file:///home/notsiri/university/projects/network/flappy-bird/server/db/economy_schema.sql):

```sql
-- 1. Table: player
CREATE TABLE public.player (
    player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_name TEXT NOT NULL UNIQUE,
    unlocked_hats INTEGER[] DEFAULT '{0, 3}', -- Free starter hats: 0 (None), 3 (Red Cap)
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Table: login
CREATE TABLE public.login (
    login_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, -- Plain text as specified
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Table: leaderboard
CREATE TABLE public.leaderboard (
    leaderboard_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES public.player(player_id) ON DELETE SET NULL,
    player_name TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Table: wallet
CREATE TABLE public.wallet (
    wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID UNIQUE NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Table: transaction_log
CREATE TABLE public.transaction_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID NOT NULL REFERENCES public.player(player_id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
```

### 2. 🧮 Authoritative Reward Formulas by Game Mode

All rewards are calculated and credited strictly on the backend server upon game over/match finish to prevent client-side spoofing:

| Game Mode | Condition / Placement | Reward Formula | Transaction Log Reason Example |
|---|---|---|---|
| **Solo Rank** | Passing pipes in single-player | `Score * 2 Coins`<br>+ `5 Coins` milestone ($\ge 10$ pipes)<br>+ `10 Coins` milestone ($\ge 20$ pipes) | `Rank Mode: Passed 12 pipes (+29 Coins)` |
| **Flappy Race** | 🥇 **1st Place** (Winner) | **50 Coins** | `Multiplayer Race: 🥇 1st Place Win (+50 Coins)` |
| **Flappy Race** | 🥈 **2nd Place** | **30 Coins** | `Multiplayer Race: 🥈 2nd Place Win (+30 Coins)` |
| **Flappy Race** | 🥉 **3rd Place** | **15 Coins** | `Multiplayer Race: 🥉 3rd Place Win (+15 Coins)` |
| **Flappy Race** | 4th+ Place / Participation | **10 Coins** (+5 bonus if finished) | `Multiplayer Race: #4 Place Win (+10 Coins)` |
| **Flappy Chained** | Team match completion | **40 Coins** per teammate | `Flappy Chained: Team Race Completed (+40 Coins)` |

### 3. 🎩 Hat Shop Catalog & Cosmetics
Players can preview cosmetics in real time, view live pricing tags (`✓ FREE`, `✓ OWNED`, or `🔒 X COINS`), and purchase hats directly:

| Hat ID | Name | Price | Unlock Status | Preview & Asset |
|---|---|---|---|---|
| **0** | **None** | `0 Coins` | Free Starter | Default bird |
| **1** | **Golden Crown** | `100 Coins` | Premium Shop Item | `assets/images/hats/hat_crown.png` |
| **2** | **Top Hat** | `50 Coins` | Premium Shop Item | `assets/images/hats/hat_top.png` |
| **3** | **Red Cap** | `0 Coins` | Free Starter | `assets/images/hats/hat_cap.png` |
| **4** | **Viking Helmet** | `75 Coins` | Premium Shop Item | `assets/images/hats/hat_viking.png` |

#### Purchase Logic Flow:
1. Server receives purchase request (`POST /api/shop/buy-hat` or WS `buy_hat`).
2. Checks if hat is already owned in `player.unlocked_hats` (returns success immediately).
3. If free, adds to `unlocked_hats` without deducting coins.
4. If premium, checks if `wallet.balance >= hat.price`. If insufficient, returns a rejected response (`Not enough coins!`).
5. Atomically deducts price from `wallet`, creates record in `transaction_log` with negative amount, updates `player.unlocked_hats`, and returns new balance.

---

## 🗄️ Supabase Real Database Setup Guide

To connect the game to your real Supabase PostgreSQL database:

### 1. Execute SQL Schema in Supabase
1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and select your project.
2. Go to **SQL Editor** -> **New Query**.
3. Copy the contents of [`server/db/economy_schema.sql`](file:///home/notsiri/university/projects/network/flappy-bird/server/db/economy_schema.sql) and click **Run**.
4. This creates all 5 tables (`player`, `login`, `leaderboard`, `wallet`, `transaction_log`), Row Level Security (RLS) policies, and performance indexes.

### 2. Configure Environment Variables
In your local root `.env` file (or PaaS dashboard environment settings):
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-anon-or-service-role-key
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[ENCODED-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[PROJECT-REF]:[ENCODED-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

### 3. REST API & WebSocket Events Reference
* **`GET /api/shop/hats`**: Returns all 5 catalog hats with pricing and free status.
* **`GET /api/player/wallet?name=PlayerName`**: Returns player's wallet balance, player UUID, and unlocked hats.
* **`POST /api/shop/buy-hat`**: Body: `{ playerName, hatId }`. Authoritative balance deduction and hat unlock.
* **`GET /api/player/transactions?name=PlayerName&limit=10`**: Returns recent transaction history with reasons and amounts.
* **`POST /api/auth/register-login`**: Body: `{ username, password, playerName }`. Records plain-text credentials in `login` table.
* **`GET /api/leaderboard?limit=10`**: Returns Top 10 rankings directly from Supabase.
* **`POST /api/rank/start`**: Creates an authoritative session token with server timestamp.
* **`POST /api/rank/game-over`**: Validates session duration against physical limits and saves score directly to Supabase.
* **WebSocket Events**:
  * `get_wallet` ➡️ `wallet_data`
  * `buy_hat` ➡️ `buy_hat_result`
  * `start_rank_session` ➡️ `rank_session_started`
  * `rank_game_over` ➡️ `rank_game_over_result`
  * `get_rank_leaderboard` ➡️ `rank_leaderboard_data`

---

## 📄 Course Evaluation

Developed for **University Network Programming & Distributed Systems** course evaluation. All rights reserved.
