// src/luranaApi.js
const axios = require('axios');
const { getAccessToken } = require('./luranaAuth');

function apiBase() {
  return `${process.env.LURANA_API_BASE_URL}/api/1.0/${process.env.LURANA_WORKSPACE}`;
}

async function authHeaders() {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function getUserData(username) {
  const url = `${apiBase()}/plugin-PsManagementTools/getUserData/${encodeURIComponent(username)}`;
  const response = await axios.get(url, { headers: await authHeaders(), timeout: 15000 });
  return response.data;
}

async function createPtoCase(payload) {
  const url = `${apiBase()}/plugin-PsManagementTools/createPtoCase/`;
  const response = await axios.post(url, payload, { headers: await authHeaders(), timeout: 20000 });
  return response.data;
}

module.exports = { getUserData, createPtoCase };