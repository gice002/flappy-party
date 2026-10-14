const assert = require("assert");
const Player = require("../server/models/Player");
const Lobby = require("../server/models/Lobby");
const Checkpoint = require("../server/models/Checkpoint");
const LobbyManager = require("../server/game/lobbyManager");

console.log("--- Testing New Items & Features (Speed, Swap, Death Note, Ice, Bucket Head) ---");

// Test 1: Player Model Fields
const p1 = new Player("p1", "Player1");
const p2 = new Player("p2", "Player2");

assert.strictEqual(p1.isBucketHead, false);
assert.strictEqual(p1.isFrozenInIce, false);
console.log("-> Test 1: Player model initial fields verified!");

// Test 2: toJSON serialization
p1.isBucketHead = true;
p1.isFrozenInIce = true;
const json = p1.toJSON();
assert.strictEqual(json.isBucketHead, true);
assert.strictEqual(json.isFrozenInIce, true);
console.log("-> Test 2: toJSON includes isBucketHead & isFrozenInIce!");

// Test 3: LobbyManager item logic setup
let emittedEvents = [];
const mockIo = {
    to: (room) => ({
        emit: (evt, payload) => {
            emittedEvents.push({ evt, payload });
        }
    })
};

const lm = new LobbyManager(mockIo);
const lobby = new Lobby("LOBBY1", "p1");
p1.ready_status = true;
p2.ready_status = true;
lobby.addPlayer(p1);
lobby.addPlayer(p2);
lobby.status = "playing";
lm.lobbies.set("LOBBY1", lobby);
lm.playerLobbyMap.set("p1", "LOBBY1");
lm.playerLobbyMap.set("p2", "LOBBY1");

// Set checkpoints
const chk1 = new Checkpoint("chk_1", "map_1", 100, 320, 0);
const chk2 = new Checkpoint("chk_2", "map_1", 500, 320, 10);
lobby.checkpoints.set("chk_1", chk1);
lobby.checkpoints.set("chk_2", chk2);

// Position P1 behind, P2 in 1st place
p1.x = 200;
p2.x = 800;
p2.checkpoint_id = "chk_2";

// Test Speed Boost
const mockSocket1 = { id: "p1" };
p1.heldItem = "speed";
lm.useItem(mockSocket1);
assert.strictEqual(p1.speedMultiplier, 1.5);
console.log("-> Test 3: Speed boost (+50% speed) verified!");

// Test Swap
p1.heldItem = "swap";
lm.useItem(mockSocket1);
assert.strictEqual(p1.x, 800);
assert.strictEqual(p2.x, 200);
console.log("-> Test 4: Position swap verified!");

// Test Death Note
p1.x = 200;
p2.x = 800;
p1.heldItem = "deathnote";
lm.useItem(mockSocket1);
// P2 (1st place) should be knocked down to ground (y=592)
assert.strictEqual(p2.isKnockedDown, true);
assert.strictEqual(p2.y, 592);
const announcement = emittedEvents.find(e => e.evt === "deathnote_announcement");
assert.ok(announcement);
assert.strictEqual(announcement.payload.attackerId, "p1");
assert.strictEqual(announcement.payload.attackerName, "Player1");
assert.strictEqual(announcement.payload.targetId, "p2");
assert.strictEqual(announcement.payload.targetName, "Player2");
console.log("-> Test 5: Death Note knockdown & targeted announcement banner verified!");

// Test Ice Freeze
p1.x = 200;
p2.x = 800;
p1.heldItem = "ice";
lm.useItem(mockSocket1);
assert.strictEqual(p2.isFrozenInIce, true);
assert.strictEqual(p2.velocityY, 0);
console.log("-> Test 6: Ice Freeze (2.5s mid-air freeze) verified!");

console.log("--- ALL NEW ITEM & FEATURE TESTS PASSED SUCCESSFULLY! ---");
