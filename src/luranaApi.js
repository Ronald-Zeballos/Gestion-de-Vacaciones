const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const { getAccessToken } = require('./luranaAuth');
const {
  setLastUserLookup,
  setLastCreateCase
} = require('./debugStore');

function apiBase() {
  if (!config.luranaApiBaseUrl || !config.luranaWorkspace) {
    throw new Error('LURANA_API_BASE_URL and LURANA_WORKSPACE must be configured');
  }

  return `${config.luranaApiBaseUrl}/api/1.0/${config.luranaWorkspace}`;
}

async function authHeaders(extraHeaders = {}) {
  const token = await getAccessToken();

  return {
    Authorization: `Bearer ${token}`,
    ...extraHeaders
  };
}

function collectAppUidCandidates(value, depth = 0, found = []) {
  if (!value || depth > 5) {
    return found;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAppUidCandidates(item, depth + 1, found);
    }

    return found;
  }

  if (typeof value !== 'object') {
    return found;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (
      ['app_uid', 'appuid', 'caseuid', 'case_uid'].includes(normalizedKey) &&
      typeof nestedValue === 'string' &&
      nestedValue.trim()
    ) {
      found.push(nestedValue.trim());
    }

    collectAppUidCandidates(nestedValue, depth + 1, found);
  }

  return found;
}

function extractAppUid(responseData) {
  const candidates = collectAppUidCandidates(responseData);
  return candidates[0] || '';
}

function serializeAxiosError(error) {
  return {
    message: error?.message || 'Unknown error',
    code: error?.code || null,
    status: error?.response?.status || null,
    statusText: error?.response?.statusText || null,
    data: error?.response?.data || null
  };
}

async function getUserData(username) {
  const url = `${apiBase()}/plugin-PsManagementTools/getUserData/${encodeURIComponent(username)}`;
  try {
    const response = await axios.get(url, {
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      timeout: 15000,
      maxRedirects: 0
    });

    setLastUserLookup({
      username,
      response: response.data,
      error: null
    });

    return response.data;
  } catch (error) {
    setLastUserLookup({
      username,
      response: null,
      error: error?.response?.data || error?.message || 'Unknown error'
    });

    throw error;
  }
}

async function createPtoCase(payload) {
  const url = `${apiBase()}/plugin-PsManagementTools/createPtoCase/`;
  setLastCreateCase({
    payload,
    response: null,
    error: null
  });

  try {
    const response = await axios.post(url, payload, {
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      timeout: 20000,
      maxRedirects: 0
    });

    setLastCreateCase({
      payload,
      response: response.data,
      error: null
    });

    return response.data;
  } catch (error) {
    setLastCreateCase({
      payload,
      response: null,
      error: serializeAxiosError(error)
    });

    throw error;
  }
}

async function uploadInputDocument(appUid, inpDocUid, tasUid, filePath, comment = '') {
  if (!appUid) {
    throw new Error('appUid is required to upload an input document');
  }

  if (!inpDocUid) {
    throw new Error('inpDocUid is required to upload an input document');
  }

  if (!tasUid) {
    throw new Error('tasUid is required to upload an input document');
  }

  if (!filePath) {
    throw new Error('filePath is required to upload an input document');
  }

  const resolvedFilePath = path.resolve(filePath);

  if (!fs.existsSync(resolvedFilePath)) {
    throw new Error(`File not found for upload: ${resolvedFilePath}`);
  }

  const form = new FormData();
  form.append('inp_doc_uid', inpDocUid);
  form.append('tas_uid', tasUid);
  form.append('app_doc_comment', comment || '');
  form.append('form', fs.createReadStream(resolvedFilePath), path.basename(resolvedFilePath));

  const url = `${apiBase()}/cases/${encodeURIComponent(appUid)}/input-document`;
  const response = await axios.post(url, form, {
    headers: await authHeaders(form.getHeaders()),
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    maxRedirects: 0
  });

  return response.data;
}

module.exports = {
  getUserData,
  createPtoCase,
  uploadInputDocument,
  extractAppUid
};
