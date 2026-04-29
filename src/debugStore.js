const store = {
  lastUserLookup: null,
  lastCreateCase: null,
  lastUpdatePtoData: null,
  lastCasesQuery: null,
  lastMedia: null,
  lastIncoming: null
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

function setLastUpdatePtoData(data) {
  store.lastUpdatePtoData = buildEntry(data);
  return store.lastUpdatePtoData;
}

function getLastUpdatePtoData() {
  return store.lastUpdatePtoData;
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

function setLastIncoming(data) {
  store.lastIncoming = buildEntry(data);
  return store.lastIncoming;
}

function getLastIncoming() {
  return store.lastIncoming;
}

function clear() {
  store.lastUserLookup = null;
  store.lastCreateCase = null;
  store.lastUpdatePtoData = null;
  store.lastCasesQuery = null;
  store.lastMedia = null;
  store.lastIncoming = null;
}

module.exports = {
  setLastUserLookup,
  getLastUserLookup,
  setLastCreateCase,
  getLastCreateCase,
  setLastUpdatePtoData,
  getLastUpdatePtoData,
  setLastCasesQuery,
  getLastCasesQuery,
  setLastMedia,
  getLastMedia,
  setLastIncoming,
  getLastIncoming,
  clear,
  setLastWhatsAppMedia: setLastMedia,
  getLastWhatsAppMedia: getLastMedia,
  setLastIncomingMessage: setLastIncoming,
  getLastIncomingMessage: getLastIncoming,
  clearDebugStore: clear
};
