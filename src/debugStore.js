const store = {
  lastUserLookup: null,
  lastCreateCase: null,
  lastCasesQuery: null,
  lastMedia: null
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

function setLastCasesQuery(data) {
  store.lastCasesQuery = buildEntry(data);
  return store.lastCasesQuery;
}

function getLastCasesQuery() {
  return store.lastCasesQuery;
}

function setLastMedia(data) {
  store.lastMedia = buildEntry(data);
  return store.lastMedia;
}

function getLastMedia() {
  return store.lastMedia;
}

function clear() {
  store.lastUserLookup = null;
  store.lastCreateCase = null;
  store.lastCasesQuery = null;
  store.lastMedia = null;
}

module.exports = {
  setLastUserLookup,
  getLastUserLookup,
  setLastCreateCase,
  getLastCreateCase,
  setLastCasesQuery,
  getLastCasesQuery,
  setLastMedia,
  getLastMedia,
  clear,
  setLastWhatsAppMedia: setLastMedia,
  getLastWhatsAppMedia: getLastMedia,
  clearDebugStore: clear
};
