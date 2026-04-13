const store = {
  lastUserLookup: null,
  lastCreateCase: null,
  lastWhatsAppMedia: null
};

function buildEntry(data) {
  return {
    at: new Date().toISOString(),
    ...data
  };
}

function setLastUserLookup(data) {
  store.lastUserLookup = buildEntry(data);
  return store.lastUserLookup;
}

function getLastUserLookup() {
  return store.lastUserLookup;
}

function setLastCreateCase(data) {
  store.lastCreateCase = buildEntry(data);
  return store.lastCreateCase;
}

function getLastCreateCase() {
  return store.lastCreateCase;
}

function setLastWhatsAppMedia(data) {
  store.lastWhatsAppMedia = buildEntry(data);
  return store.lastWhatsAppMedia;
}

function getLastWhatsAppMedia() {
  return store.lastWhatsAppMedia;
}

function clearDebugStore() {
  store.lastUserLookup = null;
  store.lastCreateCase = null;
  store.lastWhatsAppMedia = null;
}

module.exports = {
  setLastUserLookup,
  getLastUserLookup,
  setLastCreateCase,
  getLastCreateCase,
  setLastWhatsAppMedia,
  getLastWhatsAppMedia,
  clearDebugStore
};
