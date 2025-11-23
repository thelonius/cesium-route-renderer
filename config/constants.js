/**
 * ES module wrapper for constants used by frontend (Vite / browser)
 * Keep `config/constants.cjs` for server-side CommonJS consumers.
 */
import raw from './constants.json';

// Clone to avoid accidental mutation
const constants = JSON.parse(JSON.stringify(raw));

// Browser-safe overrides (if any env-like globals are present)
if (typeof process !== 'undefined' && process.env) {
  constants.DOCKER.USER_ID = process.env.DOCKER_USER_ID || constants.DOCKER.USER_ID;
  constants.DOCKER.GROUP_ID = process.env.DOCKER_GROUP_ID || constants.DOCKER.GROUP_ID;
}

export default constants;
