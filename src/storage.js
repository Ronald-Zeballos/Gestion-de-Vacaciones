const fs = require('fs');
const path = require('path');
const config = require('./config');

const baseDataDir = path.resolve(config.dataDir || './data');
const sessionsPath = path.join(baseDataDir, 'sessions.json');
const requestsPath = path.join(baseDataDir, 'requests');

function buildRequestPath(requestId) {
  return path.join(requestsPath, `${requestId}.json`);
}

function ensureDirectories() {
  fs.mkdirSync(baseDataDir, { recursive: true });
  fs.mkdirSync(requestsPath, { recursive: true });

  if (!fs.existsSync(sessionsPath)) {
    fs.writeFileSync(sessionsPath, JSON.stringify({}, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Error leyendo JSON ${filePath}:`, error.message);
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function getSessions() {
  ensureDirectories();
  return readJson(sessionsPath, {});
}

function getSession(phone) {
  const sessions = getSessions();
  return sessions[phone] || null;
}

function saveSession(phone, session) {
  const sessions = getSessions();
  sessions[phone] = session;
  writeJson(sessionsPath, sessions);
}

function clearSession(phone) {
  const sessions = getSessions();
  delete sessions[phone];
  writeJson(sessionsPath, sessions);
}

function saveRequest(requestId, payload) {
  ensureDirectories();
  writeJson(buildRequestPath(requestId), payload);
}

function getRequest(requestId) {
  ensureDirectories();

  if (!requestId) {
    return null;
  }

  return readJson(buildRequestPath(requestId), null);
}

function listRequests() {
  ensureDirectories();

  try {
    return fs.readdirSync(requestsPath)
      .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
      .map((fileName) => readJson(path.join(requestsPath, fileName), null))
      .filter(Boolean);
  } catch (error) {
    console.error('[STORAGE] Error listando solicitudes:', error.message);
    return [];
  }
}

function findRequestByAppUid(appUid) {
  ensureDirectories();

  if (!appUid) {
    return null;
  }

  const normalizedAppUid = String(appUid).trim();
  return listRequests().find((item) => String(item?.app_uid || '').trim() === normalizedAppUid) || null;
}

function updateRequest(requestId, updater) {
  ensureDirectories();

  if (!requestId || typeof updater !== 'function') {
    return null;
  }

  const current = getRequest(requestId);

  if (!current) {
    return null;
  }

  const nextValue = updater(current);

  if (!nextValue) {
    return null;
  }

  saveRequest(requestId, nextValue);
  return nextValue;
}

module.exports = {
  ensureDirectories,
  getSession,
  saveSession,
  clearSession,
  saveRequest,
  getRequest,
  updateRequest,
  listRequests,
  findRequestByAppUid
};
