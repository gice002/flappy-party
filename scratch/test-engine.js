const assert = require("assert");
const { generateMapsAndCheckpoints } = require("../server/game/mapGenerator");
const Lobby = require("../server/models/Lobby");
const Player = require("../server/models/Player");
const LeaderboardEntry = require("../server/models/Leaderboard");
const { MODES } = require("../server/models/Mode");

console.log("--- Starting Engine Verification Tests ---");

// Test 1: Map Generator for 1, 3, 5 maps
console.log("Test 1: Map Generator (1, 3, 5 maps)");
const map1Data = generateMapsAndCheckpoints(1, "TEST01");
assert.strictEqual(map1Data.maps.length, 1, "1 Map generated");
assert.strictEqual(map1Data.maps[0].pipes.length, 10, "Map 1 has 10 pipes");
assert.strictEqual(map1Data.totalPipes, 10, "Total pipes for 1 map is 10");
assert.ok(map1Data.checkpoints.has("chk_TEST01_1"), "Checkpoint 1 exists");
assert.ok(map1Data.finishLineX > 0, "Finish line exists for 1 map");

const map3Data = generateMapsAndCheckpoints(3, "TEST03");
assert.strictEqual(map3Data.maps.length, 3, "3 Maps generated");
assert.strictEqual(map3Data.totalPipes, 30, "Total pipes for 3 maps is 30");
assert.ok(map3Data.checkpoints.has("chk_TEST03_1"), "Checkpoint 1 exists");
assert.ok(map3Data.checkpoints.has("chk_TEST03_2"), "Checkpoint 2 exists");
assert.ok(map3Data.checkpoints.has("chk_TEST03_3"), "Checkpoint 3 exists");
assert.ok(map3Data.finishLineX > 0, "Finish line exists for 3 maps");

const map5Data = generateMapsAndCheckpoints(5, "TEST05");
assert.strictEqual(map5Data.maps.length, 5, "5 Maps generated");
assert.strictEqual(map5Data.totalPipes, 50, "Total pipes for 5 maps is 50");
for (let m = 1; m <= 5; m++) {
    assert.strictEqual(map5Data.maps[m - 1].pipes.length, 10, `Map ${m} has 10 pipes`);
    assert.ok(map5Data.checkpoints.has(`chk_TEST05_${m}`), `Checkpoint ${m} exists`);
}
assert.ok(map5Data.finishLineX > 0, "Finish line exists for 5 maps");

// Test 2: Domain Entities
console.log("Test 2: Domain Entities Schema");
const player = new Player("p1", "Alice", 1, 2);
assert.strictEqual(player.name, "Alice");
assert.strictEqual(player.skin_ID, 1);
assert.strictEqual(player.hat_ID, 2);
assert.strictEqual(player.ready_status, false);

const lobby = new Lobby("LOBBY1", "p1");
lobby.addPlayer(player);
assert.strictEqual(lobby.Lobby_id, "LOBBY1");
assert.strictEqual(lobby.host_ID, "p1");

// Test 3: Leaderboard Entry formatting
console.log("Test 3: Leaderboard Formatting");
const lbEntry = new LeaderboardEntry("lb_1", "p1", "LOBBY1", null, null, "Alice", "[ OUT ] CRASHED AT PIPE 14");
assert.strictEqual(lbEntry.status_text, "[ OUT ] CRASHED AT PIPE 14");

console.log("--- ALL ENGINE VERIFICATION TESTS PASSED SUCCESSFULLY! ---");
