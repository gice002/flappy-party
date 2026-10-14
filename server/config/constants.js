// Server Physics & Gameplay Constants

const TICK_RATE = 60; // 60 FPS server physics loop
const TICK_INTERVAL = 1000 / TICK_RATE;

const BIRD_WIDTH = 34;
const BIRD_HEIGHT = 24;
const GROUND_Y = 616; // 640 - 24
const GRAVITY = 0.4;
const JUMP_VELOCITY = -6;
const FORWARD_VELOCITY = 2.0;
const CHAIN_SPACING_X = 60; // Fixed horizontal spacing offset for Chained Mode

// Map Generation Constants
const PIPE_WIDTH = 64;
const PIPE_HEIGHT = 512;
const PIPE_SPACING_X = 380;
const START_X = 600;
const MIN_GAP = 160;
const MAX_GAP = 240;

// Theme Pools
const DEFAULT_THEME = "classic_day";
const SUBSEQUENT_THEMES = [
    "new_underwater_map",
    "volcano",
    "snowy",
    "candyland",
    "desert",
    "city_night",
    "city_dusk"
];

// Item System Parameters & Duration Buffs
const CURSE_SPEED_MULTIPLIER = 0.65; // 35% speed reduction
const SPEED_BOOST_MULTIPLIER = 1.50;  // 50% speed increase
const CURSE_DURATION_MS = 6000;      // 6 seconds
const BUCKET_DURATION_MS = 5000;     // 5 seconds
const SHIELD_DURATION_MS = 5000;     // 5 seconds
const INVINCIBLE_DURATION_MS = 3000; // 3 seconds
const SPEED_BOOST_DURATION_MS = 4000;// 4 seconds
const ICE_DURATION_MS = 2500;        // 2.5 seconds
const ITEM_RESPAWN_MS = 3000;        // 3 seconds
const ITEM_PICKUP_COOLDOWN_MS = 3000; // 3 seconds cooldown between picking up item boxes

// Chained Mode & Dash Constants
const DASH_COOLDOWN_MS = 3500;       // 3.5 seconds dash cooldown
const DASH_BURST_X = 65;             // Forward burst distance in pixels
const MAX_TETHER_DIST = 110;         // Maximum tether extension before tension kicks in
const TETHER_SPRING_FORCE = 0.18;    // Restorative tension spring multiplier

module.exports = {
    TICK_RATE,
    TICK_INTERVAL,
    BIRD_WIDTH,
    BIRD_HEIGHT,
    GROUND_Y,
    GRAVITY,
    JUMP_VELOCITY,
    FORWARD_VELOCITY,
    CHAIN_SPACING_X,
    PIPE_WIDTH,
    PIPE_HEIGHT,
    PIPE_SPACING_X,
    START_X,
    MIN_GAP,
    MAX_GAP,
    DEFAULT_THEME,
    SUBSEQUENT_THEMES,
    CURSE_SPEED_MULTIPLIER,
    SPEED_BOOST_MULTIPLIER,
    CURSE_DURATION_MS,
    BUCKET_DURATION_MS,
    SHIELD_DURATION_MS,
    INVINCIBLE_DURATION_MS,
    SPEED_BOOST_DURATION_MS,
    ICE_DURATION_MS,
    ITEM_RESPAWN_MS,
    ITEM_PICKUP_COOLDOWN_MS,
    DASH_COOLDOWN_MS,
    DASH_BURST_X,
    MAX_TETHER_DIST,
    TETHER_SPRING_FORCE
};
