const axios = require('axios');
const config = require('./config');

function buildHeaders() {
  return {
    Authorization: `Bearer ${config.luranaAccessToken}`,
    'Content-Type': 'application/json'
  };
}

async function getUserData(username) {
  const url = `${config.luranaApiBaseUrl}/api/1.0/${config.luranaWorkspace}/plugin-PsManagementTools/getUserData/${encodeURIComponent(username)}`;

  const response = await axios.get(url, {
    headers: buildHeaders()
  });

  return response.data;
}

async function createPtoCase(payload) {
  const url = `${config.luranaApiBaseUrl}/api/1.0/${config.luranaWorkspace}/plugin-PsManagementTools/createPtoCase/`;

  const response = await axios.post(url, payload, {
    headers: buildHeaders()
  });

  return response.data;
}

module.exports = {
  getUserData,
  createPtoCase
};
