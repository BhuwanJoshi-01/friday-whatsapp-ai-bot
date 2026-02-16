'use strict';

/**
 * Singleton EventEmitter — the backbone for all inter-module communication.
 * Every module publishes/subscribes through named events on this bus.
 */

const { EventEmitter } = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // we have many modules
  }

  /**
   * Emit with error catching — prevents one bad listener from crashing the bus.
   */
  safeEmit(event, ...args) {
    // console.log(`[EventBus] Emitting event: ${event}`);
    try {
      this.emit(event, ...args);
    } catch (err) {
      console.error(`[EventBus] Error in listener for "${event}":`, err);
    }
  }
}

const bus = new EventBus();

module.exports = bus;
