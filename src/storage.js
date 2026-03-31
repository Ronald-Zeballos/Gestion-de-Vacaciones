const fs = require('fs');
const path = require('path');
const config = require('./config');

const sessionsPath = path.resolve(config.dataDir, 'sessions.json');
const requestsPath = path.resolve(config.dataDir, 'requests');
const employeesPath = path.resolve(config.dataDir, 'employees');

function ensureDirectories() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(requestsPath, { recursive: true });
  fs.mkdirSync(employeesPath, { recursive: true });

  if (!fs.existsSync(sessionsPath)) {
    fs.writeFileSync(sessionsPath, JSON.stringify({}, null, 2), 'utf8');
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
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

function saveEmployee(employee) {
  ensureDirectories();
  const safeId = String(employee.var_user_name || employee.phone || 'sin_usuario');
  writeJson(path.join(employeesPath, `${safeId}.json`), employee);
}

function saveRequest(requestId, payload) {
  ensureDirectories();
  writeJson(path.join(requestsPath, `${requestId}.json`), payload);
}

module.exports = {
  ensureDirectories,
  getSession,
  saveSession,
  clearSession,
  saveEmployee,
  saveRequest
};