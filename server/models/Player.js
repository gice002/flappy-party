class Player {
    constructor(player_id, name, skin_ID = 0, hat_ID = 0) {
        this.player_id = player_id;
        this.checkpoint_id = null; // FK to Checkpoint
        this.name = name || `Bird_${player_id.substring(0, 4)}`;
        this.skin_ID = skin_ID;
        this.hat_ID = hat_ID;
        this.ready_status = false;

        // Runtime Physics & State
        this.x = 100;
        this.y = 320;
        this.velocityY = 0;
        this.last_processed_input = 0;
        this.is_finished = false;
        this.finish_time = null; // in seconds from match start
        this.last_pipe_passed = 0;
        this.is_alive = true;
        this.crashed_at_pipe = null;
        this.chain_index = 0;
        this.wipes_caused = 0; // Mode B Chained mode wipe tracker

        // Inventory & Power-Up System State
        this.heldItem = null;       // "ink" | "curse" | "shield" | "speed" | "swap" | "deathnote" | "ice"
        this.itemPickupCooldownUntil = null; // Timestamp ms when 3s pickup cooldown expires
        this.dashCooldownUntil = null; // Timestamp ms when dash cooldown expires
        this.hasShield = false;     // Buff: active barrier
        this.isInvincible = false;  // Buff: 3s pipe immunity post-shield block, or 4s recovery shield
        this.invincibleUntil = null; // Timestamp ms for invincibility expiration
        this.isKnockedDown = false; // State: down on ground
        this.knockdownUntil = null; // Timestamp ms when 5s knockdown expires
        this.isReadyToFly = false;  // Prompt: ready for player to flap
        this.isBucketHead = false;  // Visual debuff: bucket icon over bird head
        this.isFrozenInIce = false; // Debuff: 2.5s ice freeze mid-air
        this.speedMultiplier = 1.0; // Debuff: 0.65 when cursed, 1.50 speed boost, 1.0 normal
        this.curseTimer = null;
        this.shieldTimer = null;
        this.invincibleTimer = null;
        this.bucketTimer = null;
        this.iceTimer = null;
        this.speedTimer = null;
    }

    resetForMatch(startX, startY, initialCheckpointId) {
        this.x = startX;
        this.y = startY;
        this.velocityY = 0;
        this.checkpoint_id = initialCheckpointId;
        this.last_processed_input = 0;
        this.is_finished = false;
        this.finish_time = null;
        this.last_pipe_passed = 0;
        this.is_alive = true;
        this.crashed_at_pipe = null;
        this.wipes_caused = 0;

        this.heldItem = null;
        this.itemPickupCooldownUntil = null;
        this.dashCooldownUntil = null;
        this.hasShield = false;
        this.isInvincible = false;
        this.invincibleUntil = null;
        this.isKnockedDown = false;
        this.knockdownUntil = null;
        this.isReadyToFly = false;
        this.isBucketHead = false;
        this.isFrozenInIce = false;
        this.speedMultiplier = 1.0;
        if (this.curseTimer) clearTimeout(this.curseTimer);
        this.curseTimer = null;
        if (this.shieldTimer) clearTimeout(this.shieldTimer);
        this.shieldTimer = null;
        if (this.invincibleTimer) clearTimeout(this.invincibleTimer);
        this.invincibleTimer = null;
        if (this.bucketTimer) clearTimeout(this.bucketTimer);
        this.bucketTimer = null;
        if (this.iceTimer) clearTimeout(this.iceTimer);
        this.iceTimer = null;
        if (this.speedTimer) clearTimeout(this.speedTimer);
        this.speedTimer = null;
    }

    toJSON() {
        return {
            player_id: this.player_id,
            checkpoint_id: this.checkpoint_id,
            name: this.name,
            skin_ID: this.skin_ID,
            hat_ID: this.hat_ID,
            ready_status: this.ready_status,
            x: this.x,
            y: this.y,
            velocityY: this.velocityY,
            last_processed_input: this.last_processed_input,
            is_finished: this.is_finished,
            finish_time: this.finish_time,
            last_pipe_passed: this.last_pipe_passed,
            is_alive: this.is_alive,
            crashed_at_pipe: this.crashed_at_pipe,
            chain_index: this.chain_index,
            wipes_caused: this.wipes_caused,
            heldItem: this.heldItem,
            itemPickupCooldownUntil: this.itemPickupCooldownUntil,
            dashCooldownUntil: this.dashCooldownUntil,
            hasShield: this.hasShield,
            isInvincible: this.isInvincible,
            invincibleUntil: this.invincibleUntil,
            isKnockedDown: this.isKnockedDown,
            knockdownUntil: this.knockdownUntil,
            isReadyToFly: this.isReadyToFly,
            isBucketHead: this.isBucketHead,
            isFrozenInIce: this.isFrozenInIce,
            speedMultiplier: this.speedMultiplier
        };
    }
}

module.exports = Player;
