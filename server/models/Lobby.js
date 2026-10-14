class Lobby {
    constructor(Lobby_id, host_ID) {
        this.Lobby_id = Lobby_id;
        this.mode_id = "flappy_race"; // Default mode
        this.host_ID = host_ID;
        this.amount_of_map = 1; // Default 1 map (10 pipes), options: 1, 3, 5

        this.status = "waiting"; // "waiting", "loading", "playing", "finished"
        this.players = new Map(); // socketId/player_id -> Player object

        this.maps = []; // Array of MapData objects
        this.checkpoints = new Map(); // checkpoint_id -> Checkpoint object
        this.itemBoxes = []; // Array of { id, x, y, collected: bool, collectedBy: playerId }
        
        this.finishLineX = 0;
        this.totalPipes = 10;

        this.matchStartTime = 0;
        this.finishTimerStart = null;
        this.finishCountdownSeconds = 10;

        this.loadingReadyPlayers = new Set(); // Set of player_ids ready in loading screen
        this.loadingTimer = null; // Server 15s loading timeout handle

        this.leaderboard = []; // Array of LeaderboardEntry
    }

    addPlayer(player) {
        this.players.set(player.player_id, player);
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        this.loadingReadyPlayers.delete(playerId);
        if (this.host_ID === playerId && this.players.size > 0) {
            this.host_ID = Array.from(this.players.keys())[0];
        }
    }

    allPlayersReady() {
        const minPlayers = (this.mode_id === "flappy_boss") ? 1 : 2;
        if (this.players.size < minPlayers) return false;
        for (let player of this.players.values()) {
            if (!player.ready_status) return false;
        }
        return true;
    }
}

module.exports = Lobby;
