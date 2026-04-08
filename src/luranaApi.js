const axios = require('axios');
const config = require('./config');
const { getAccessToken } = require('./luranaAuth');

function apiUrl(path) {
  return `${config.luranaApiBaseUrl}/api/1.0/${config.luranaWorkspace}${path}`;
}

async function authHeaders() {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

async function getUserData(username) {
  const { data } = await axios.get(
    apiUrl(`/plugin-PsManagementTools/getUserData/${encodeURIComponent(username)}`),
    { headers: await authHeaders() }
  );
  return data;
}

async function createPtoCase(payload) {
  const { data } = await axios.post(
    apiUrl('/plugin-PsManagementTools/createPtoCase/'),
    payload,
    { headers: { ...(await authHeaders()), 'Content-Type': 'application/json' } }
  );
  return data;
}

module.exports = { getUserData, createPtoCase };