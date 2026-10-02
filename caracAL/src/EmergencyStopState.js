"use strict";

class EmergencyStopState {
  constructor({ now } = {}) {
    this.now = now || (() => Date.now());
    this.active = false;
    this.reason = null;
    this.activatedAt = null;
    this.clearedAt = null;
    this.revision = 0;
  }

  activate(reason = "MANUAL_EMERGENCY_STOP") {
    const normalizedReason = String(reason || "MANUAL_EMERGENCY_STOP").slice(
      0,
      512,
    );

    if (this.active && this.reason === normalizedReason) {
      return this.snapshot();
    }

    this.active = true;
    this.reason = normalizedReason;
    this.activatedAt = this.now();
    this.revision += 1;
    return this.snapshot();
  }

  clear(reason = "MANUAL_EMERGENCY_CLEAR") {
    const normalizedReason = String(reason || "MANUAL_EMERGENCY_CLEAR").slice(
      0,
      512,
    );

    if (!this.active) {
      return this.snapshot();
    }

    this.active = false;
    this.reason = normalizedReason;
    this.clearedAt = this.now();
    this.revision += 1;
    return this.snapshot();
  }

  snapshot() {
    return {
      active: this.active,
      reason: this.reason,
      activated_at: this.activatedAt,
      cleared_at: this.clearedAt,
      revision: this.revision,
    };
  }
}

module.exports = {
  EmergencyStopState,
};
