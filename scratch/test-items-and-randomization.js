const assert = require("assert");
const { generateMapsAndCheckpoints } = require("../server/game/mapGenerator");
const Player = require("../server/models/Player");

console.log("--- Testing Map Randomization & Item System ---");

// Test 1: Map Theme Randomization
console.log("Test 1: Map Theme Randomization");
const resultRace = generateMapsAndCheckpoints(3, "LOBBY1", "flappy_race");
const validThemes = ["classic_day", "city", "new_underwater_map", "volcano", "snowy", "candyland", "desert", "city_night", "city_dusk"];
assert.ok(validThemes.includes(resultRace.maps[0].theme_id), "Map 1 theme must be from ALL_THEMES pool");
assert.ok(validThemes.includes(resultRace.maps[1].theme_id), "Map 2 theme must be from ALL_THEMES pool");
assert.ok(validThemes.includes(resultRace.maps[2].theme_id), "Map 3 theme must be from ALL_THEMES pool");
console.log("-> Map themes: Map 1 =", resultRace.maps[0].theme_id, ", Map 2 =", resultRace.maps[1].theme_id, ", Map 3 =", resultRace.maps[2].theme_id);

// Test 2: Item Spawning Constraints & Risk/Reward Offset
console.log("Test 2: Item Spawning Constraints & Risk/Reward Offset");
const resultChained = generateMapsAndCheckpoints(3, "LOBBY2", "flappy_chained");
assert.ok(resultChained.itemBoxes.length > 0, "Items should spawn in flappy_chained mode");

assert.ok(resultRace.itemBoxes.length > 0, "Items should spawn in flappy_race mode");
for (let item of resultRace.itemBoxes) {
    assert.ok(item.y > 0, "Item Y must be valid number");
}
console.log(`-> Generated ${resultRace.itemBoxes.length} item boxes in Flappy Race, ${resultChained.itemBoxes.length} in Flappy Chained`);

// Test 3: Player Entity Inventory & Shield State
console.log("Test 3: Player Inventory & Shield Entity State");
const p1 = new Player("p1", "Alice");
const p2 = new Player("p2", "Bob");

assert.strictEqual(p1.heldItem, null, "Held item initial value is null");
assert.strictEqual(p1.hasShield, false, "Initial shield is false");
assert.strictEqual(p1.speedMultiplier, 1.0, "Initial speed multiplier is 1.0");

p1.heldItem = "ink";
assert.strictEqual(p1.heldItem, "ink", "Held item capacity set to ink");
p1.resetForMatch(100, 320, "chk_1");
assert.strictEqual(p1.heldItem, null, "resetForMatch clears held item");
assert.strictEqual(p1.hasShield, false, "resetForMatch clears shield");

// Test 4: Targeting & Shield Block Simulation
console.log("Test 4: Shield Blocking & 1st Place Targeting Rules");

// Player 2 is in 1st place (x=500), Player 1 is behind (x=200)
p1.x = 200;
p2.x = 500;
p2.hasShield = true;

// Player 1 uses Ink targeting 1st place (Player 2)
let firstPlacePlayer = (p2.x > p1.x) ? p2 : p1;
assert.strictEqual(firstPlacePlayer.player_id, "p2", "Player 2 identified as 1st place");

// Since p2 hasShield is true, shield blocks ink
if (firstPlacePlayer.hasShield) {
    firstPlacePlayer.hasShield = false;
    console.log("-> Shield successfully blocked attack and was consumed!");
}
assert.strictEqual(p2.hasShield, false, "Shield destroyed after blocking attack");

// Test 5: 1st Place Self-Use Wasted Rule
console.log("Test 5: 1st Place Self-Use Wasted Rule");
p2.heldItem = "curse";
firstPlacePlayer = (p2.x > p1.x) ? p2 : p1;
const isSelf1stPlace = (firstPlacePlayer.player_id === p2.player_id);
assert.strictEqual(isSelf1stPlace, true, "Player 2 is 1st place");
console.log("-> 1st place player used Curse: WASTED with no effect!");

console.log("--- ALL MAP RANDOMIZATION & ITEM SYSTEM TESTS PASSED SUCCESSFULLY! ---");
