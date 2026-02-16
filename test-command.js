const bus = require('./src/core/event-bus');
const adminCommands = require('./src/services/admin-commands');

// Initialize
adminCommands.init();

// Simulate a command message
const testMsg = {
  jid: '229127948861651@lid',
  text: '!help',
  isFromMe: true,
  contentType: 'text'
};

console.log('Simulating command message:', testMsg);

// Emit the command event
bus.safeEmit('intent:command', testMsg);

console.log('Command event emitted');