const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const { getAccessToken } = require('./luranaAuth');
const {
  setLastUserLookup,
  setLastCreateCase,
  setLastCasesQuery
} = require('./debugStore');
const {
  getDigitsOnly,
  normalizePhoneNumber,
  normalizeText
} = require('./utils');

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

function getDebugErrorValue(error) {
  return error?.response?.data || error?.message || 'Unknown error';
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
      error: getDebugErrorValue(error)
    });

    throw error;
  }
}

function buildPhoneLookupTemplates() {
  return String(config.luranaPhoneLookupPaths || '')
    .split(',')
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function buildPhoneLookupCandidates(phone) {
  const rawPhone = normalizeText(phone);
  const digitsOnly = getDigitsOnly(rawPhone);
  const normalizedPhone = normalizePhoneNumber(rawPhone, config.defaultCountryCode);
  const countryCode = getDigitsOnly(config.defaultCountryCode);
  const localPhone =
    normalizedPhone.startsWith(countryCode) && normalizedPhone.length > countryCode.length
      ? normalizedPhone.slice(countryCode.length)
      : '';

  return [...new Set([
    normalizedPhone,
    digitsOnly,
    localPhone,
    normalizedPhone ? `+${normalizedPhone}` : '',
    rawPhone
  ].map((item) => normalizeText(item)).filter(Boolean))];
}

function buildLookupPath(template, phoneCandidate, rawPhone) {
  const normalizedTemplate = normalizeText(template).replace(/^\/+/, '');

  if (!normalizedTemplate) {
    return '';
  }

  if (!normalizedTemplate.includes('{')) {
    return `${normalizedTemplate.replace(/\/+$/, '')}/${encodeURIComponent(phoneCandidate)}`;
  }

  return normalizedTemplate
    .replace(/\{phone\}/gi, encodeURIComponent(phoneCandidate))
    .replace(/\{normalizedPhone\}/gi, encodeURIComponent(phoneCandidate))
    .replace(/\{rawPhone\}/gi, encodeURIComponent(rawPhone));
}

function isPhoneLookupMiss(error) {
  const status = Number(error?.response?.status || 0);
  return status === 400 || status === 404 || status === 422;
}

async function getUserDataByPhone(phone) {
  const rawPhone = normalizeText(phone);
  const lookupTemplates = buildPhoneLookupTemplates();
  const phoneCandidates = buildPhoneLookupCandidates(rawPhone);
  let lastLookupError = null;
  const attempts = [];

  if (!rawPhone || !lookupTemplates.length || !phoneCandidates.length) {
    setLastUserLookup({
      lookupType: 'phone',
      phone: rawPhone,
      phoneCandidates,
      lookupTemplates,
      attempts,
      response: null,
      error: 'Phone lookup is not configured or the phone is empty'
    });

    return null;
  }

  for (const template of lookupTemplates) {
    for (const phoneCandidate of phoneCandidates) {
      const requestPath = buildLookupPath(template, phoneCandidate, rawPhone);
      const url = `${apiBase()}/${requestPath}`;

      try {
        const response = await axios.get(url, {
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          timeout: 15000,
          maxRedirects: 0
        });

        setLastUserLookup({
          lookupType: 'phone',
          phone: rawPhone,
          phoneCandidates,
          lookupTemplates,
          normalizedPhone: phoneCandidate,
          requestPath,
          attempts: [
            ...attempts,
            {
              phoneCandidate,
              requestPath,
              status: response.status,
              ok: true
            }
          ],
          response: response.data,
          error: null
        });

        return response.data;
      } catch (error) {
        attempts.push({
          phoneCandidate,
          requestPath,
          status: Number(error?.response?.status || 0) || null,
          ok: false,
          error: getDebugErrorValue(error)
        });

        if (isPhoneLookupMiss(error)) {
          lastLookupError = error;
          continue;
        }

        setLastUserLookup({
          lookupType: 'phone',
          phone: rawPhone,
          phoneCandidates,
          lookupTemplates,
          normalizedPhone: phoneCandidate,
          requestPath,
          attempts,
          response: null,
          error: getDebugErrorValue(error)
        });

        throw error;
      }
    }
  }

  setLastUserLookup({
    lookupType: 'phone',
    phone: rawPhone,
    phoneCandidates,
    lookupTemplates,
    attempts,
    response: null,
    error: lastLookupError ? getDebugErrorValue(lastLookupError) : 'No user found for phone'
  });

  return null;
}

async function createPtoCase(payload) {
  const url = `${apiBase()}/plugin-PsManagementTools/createPtoCase/`;
  setLastCreateCase({
    payload,
    response: null,
    error: null,
    extractedAppUid: null
  });

  try {
    const response = await axios.post(url, payload, {
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      timeout: 20000,
      maxRedirects: 0
    });

    const extractedAppUid =
      response.data?.app_uid ||
      response.data?.data?.app_uid ||
      response.data?.appUid ||
      response.data?.data?.appUid ||
      response.data?.caseUid ||
      response.data?.data?.caseUid ||
      extractAppUid(response.data) ||
      null;

    setLastCreateCase({
      payload,
      response: response.data,
      error: null,
      extractedAppUid
    });

    return response.data;
  } catch (error) {
    setLastCreateCase({
      payload,
      response: null,
      error: getDebugErrorValue(error),
      extractedAppUid: null
    });

    throw error;
  }
}

async function listRecentCases(proUid, limit = 10) {
  const normalizedLimit = Number(limit) > 0 ? Number(limit) : 10;
  const query = {
    proUid: proUid || '',
    limit: normalizedLimit
  };

  const params = {
    start: 0,
    limit: normalizedLimit,
    sort: 'APP_CREATE_DATE',
    dir: 'DESC'
  };

  if (proUid) {
    params.pro_uid = proUid;
  }

  const url = `${apiBase()}/cases`;

  try {
    const response = await axios.get(url, {
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      params,
      timeout: 20000,
      maxRedirects: 0
    });

    setLastCasesQuery({
      query,
      response: response.data,
      error: null
    });

    return response.data;
  } catch (error) {
    setLastCasesQuery({
      query,
      response: null,
      error: getDebugErrorValue(error)
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
  getUserDataByPhone,
  createPtoCase,
  listRecentCases,
  uploadInputDocument,
  extractAppUid
};
