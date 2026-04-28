const fs = require('fs');
const path = require('path');
const config = require('./config');

const baseDataDir = path.resolve(config.dataDir || './data');
const profilesPath = path.join(baseDataDir, 'profiles.json');

function ensureProfilesFile() {
  fs.mkdirSync(baseDataDir, { recursive: true });

  if (!fs.existsSync(profilesPath)) {
    fs.writeFileSync(profilesPath, JSON.stringify({}, null, 2), 'utf8');
  }
}

function readProfiles() {
  ensureProfilesFile();

  try {
    const raw = fs.readFileSync(profilesPath, 'utf8');
    return raw?.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('[PROFILES] Error leyendo profiles.json:', error.message);
    return {};
  }
}

function writeProfiles(profiles) {
  ensureProfilesFile();
  fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), 'utf8');
}

function getProfile(phone) {
  const profiles = readProfiles();
  return profiles[phone] || null;
}

function saveProfile(phone, profile) {
  if (!phone || !profile?.username) return;

  const profiles = readProfiles();
  profiles[phone] = {
    username: profile.username,
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
    email: profile.email || '',
    phone: profile.phone || '',
    updatedAt: new Date().toISOString()
  };
  writeProfiles(profiles);
}

function clearProfile(phone) {
  const profiles = readProfiles();
  delete profiles[phone];
  writeProfiles(profiles);
}

module.exports = {
  getProfile,
  saveProfile,
  clearProfile
};
