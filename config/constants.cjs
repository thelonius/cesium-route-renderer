/**
 * Central configuration for all constants and magic numbers
 * Used across server and telegram bot
 */

const fs = require('fs');
const path = require('path');

// Load canonical JSON constants
const jsonPath = path.join(__dirname, 'constants.json');
let base = {};
try {
  base = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  console.warn('Could not load config/constants.json, falling back to embedded defaults');
  base = {};
}

// Apply runtime overrides from process.env for Docker/server use
const constants = Object.assign({}, base);
constants.DOCKER = Object.assign({}, constants.DOCKER, {
  USER_ID: process.env.DOCKER_USER_ID || constants.DOCKER?.USER_ID,
  GROUP_ID: process.env.DOCKER_GROUP_ID || constants.DOCKER?.GROUP_ID
});

module.exports = constants;
