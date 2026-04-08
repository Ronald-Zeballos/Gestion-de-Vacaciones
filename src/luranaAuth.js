// src/luranaAuth.js
const axios = require('axios');

let cachedToken = null;
let cachedExpiresAt = 0; // timestamp en ms

async function getAccessToken() {
  // si aún no expiró, reutiliza
  if (cachedToken && Date.now() < cachedExpiresAt) return cachedToken;

  const tokenUrl = process.env.LURANA_TOKEN_URL;

  const { data } = await axios.post(
    tokenUrl,
    {
      grant_type: 'password',
      client_id: process.env.LURANA_CLIENT_ID,
      client_secret: process.env.LURANA_CLIENT_SECRET,
      username: process.env.LURANA_USER,
      password: process.env.LURANA_PASSWORD,
      scope: process.env.LURANA_SCOPE || '*'
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  // guarda token y expira 60s antes para evitar cortes
  cachedToken = data.access_token;
  cachedExpiresAt = Date.now() + (Number(data.expires_in || 0) * 1000) - 60000;

  return cachedToken;
}

module.exports = { getAccessToken };