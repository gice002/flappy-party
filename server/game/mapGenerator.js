const MapData = require("../models/Map");
const Checkpoint = require("../models/Checkpoint");
const {
    DEFAULT_THEME,
    SUBSEQUENT_THEMES,
    PIPE_WIDTH,
    PIPE_HEIGHT,
    GROUND_Y,
    PIPE_SPACING_X,
    START_X,
    MIN_GAP,
    MAX_GAP
} = require("../config/constants");

function generateMapsAndCheckpoints(amountOfMaps, lobbyId, modeId = "flappy_race") {
    const maps = [];
    const checkpoints = new Map();
    const itemBoxes = [];

    const pipeWidth = PIPE_WIDTH;
    const pipeHeight = PIPE_HEIGHT;
    const groundY = GROUND_Y;

    // BALANCED GAMEPLAY PARAMETERS
    const pipeSpacingX = PIPE_SPACING_X;
    const startX = START_X;

    let pipeIndexCounter = 0;
    let currentX = startX;
    let computedFinishLineX = 0;

    // Initial starting checkpoint 0
    const startCheckpointId = `chk_${lobbyId}_0`;
    checkpoints.set(startCheckpointId, new Checkpoint(
        startCheckpointId,
        `map_${lobbyId}_1`,
        100,
        320,
        0
    ));

    for (let m = 1; m <= amountOfMaps; m++) {
        const mapId = `map_${lobbyId}_${m}`;
        const isFinalMap = (m === amountOfMaps);
        const mapPipes = [];
        const itemXList = [];
        const itemYList = [];

        // 1. Map Theme Randomization: Map 1 MUST be default "classic_day", subsequent maps are random from pool
        let themeId = DEFAULT_THEME;
        if (m > 1) {
            const randomIndex = Math.floor(Math.random() * SUBSEQUENT_THEMES.length);
            themeId = SUBSEQUENT_THEMES[randomIndex];
        }

        const checkpointId = `chk_${lobbyId}_${m}`;
        const mapSpawnX = (m === 1) ? 100 : (currentX - pipeSpacingX + 100);
        const mapSpawnY = 320;

        for (let i = 1; i <= 10; i++) {
            pipeIndexCounter++;

            // Dynamic Y-Axis Gap Randomization per pipe
            const gapSize = Math.floor(Math.random() * (MAX_GAP - MIN_GAP + 1)) + MIN_GAP;

            // Calculate safe top pipe Y position
            const maxVisibleTopHeight = groundY - gapSize - 60;
            const minVisibleTopHeight = 60;
            const visibleTopHeight = Math.floor(Math.random() * (maxVisibleTopHeight - minVisibleTopHeight + 1)) + minVisibleTopHeight;

            const topY = visibleTopHeight - pipeHeight;
            const bottomY = topY + pipeHeight + gapSize;

            mapPipes.push({
                pipeIndex: pipeIndexCounter,
                mapSequence: m,
                theme_id: themeId,
                x: currentX,
                width: pipeWidth,
                height: pipeHeight,
                topY: topY,
                bottomY: bottomY,
                topHeight: pipeHeight,
                bottomHeight: pipeHeight,
                gapSize: gapSize
            });

            // 2. Item Spawning: Spawn Lucky Blocks at pipes 2, 4, 7, 9
            if (i === 2 || i === 4 || i === 7 || i === 9) {
                const itemX = currentX + Math.floor(pipeSpacingX / 2);
                const centerGapY = topY + pipeHeight + Math.floor(gapSize / 2);

                for (let boxIdx = 0; boxIdx < 6; boxIdx++) {
                    const boxY = centerGapY - 100 + (boxIdx * 40);

                    itemXList.push(itemX);
                    itemYList.push(boxY);

                    itemBoxes.push({
                        id: `item_${lobbyId}_${pipeIndexCounter}_${boxIdx}`,
                        x: itemX,
                        y: boxY,
                        width: 32,
                        height: 32,
                        collected: false,
                        isActive: true,
                        collectedBy: null
                    });
                }
            }

            currentX += pipeSpacingX;
        }

        // Zone placed after the 10th pipe
        const respawnX = currentX + Math.floor(pipeSpacingX / 2);
        const respawnY = 320;

        if (isFinalMap) {
            // On the final map, after pipe 10 is the clean Finish Line Zone (NO item boxes)
            computedFinishLineX = respawnX;
        } else {
            // Intermediate map Checkpoint Zone: spawn pre-checkpoint item boxes
            const preChkItemX = respawnX - 140;
            for (let boxIdx = 0; boxIdx < 6; boxIdx++) {
                const boxY = 160 + (boxIdx * 40);

                    itemXList.push(preChkItemX);
                    itemYList.push(boxY);

                    itemBoxes.push({
                        id: `item_${lobbyId}_chk_pre_${m}_${boxIdx}`,
                        x: preChkItemX,
                        y: boxY,
                        width: 32,
                        height: 32,
                        collected: false,
                        isActive: true,
                        collectedBy: null
                    });
            }
        }

        const checkpointObj = new Checkpoint(
            checkpointId,
            mapId,
            respawnX,
            respawnY,
            pipeIndexCounter
        );
        checkpoints.set(checkpointId, checkpointObj);

        // Expand Zone spacing to PIPE_SPACING_X * 2 (760px) before next map
        currentX += pipeSpacingX * 2;

        const mapObj = new MapData(
            mapId,
            checkpointId,
            `Map ${m}`,
            m,
            isFinalMap,
            mapSpawnX,
            mapSpawnY,
            itemXList,
            itemYList,
            mapPipes,
            themeId
        );

        maps.push(mapObj);
    }

    const lastMapPipes = maps[maps.length - 1].pipes;
    const lastPipe = lastMapPipes[lastMapPipes.length - 1];
    const finishLineX = computedFinishLineX || (lastPipe ? (lastPipe.x + pipeWidth + 380) : currentX);

    return {
        maps,
        checkpoints,
        itemBoxes,
        startCheckpointId,
        finishLineX,
        totalPipes: amountOfMaps * 10
    };
}

module.exports = { generateMapsAndCheckpoints };
