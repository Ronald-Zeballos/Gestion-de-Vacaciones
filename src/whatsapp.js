// src/whatsapp.js
const axios = require('axios');
const config = require('./config');

async function sendRequest(data) {
  if (!config.whatsappToken || !config.phoneNumberId) {
    console.log('[SIMULADO]', JSON.stringify(data, null, 2));
    return;
  }

  const url = `https://graph.facebook.com/v23.0/${config.phoneNumberId}/messages`;

  await axios.post(url, data, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      'Content-Type': 'application/json'
    }
  });
}

async function sendTextMessage(to, body) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  });
}

async function sendButtonsMessage(to, body, buttons) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title
          }
        }))
      }
    }
  });
}

async function sendListMessage(to, body, buttonText, sections) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText,
        sections
      }
    }
  });
}

module.exports = {
  sendTextMessage,
  sendButtonsMessage,
  sendListMessage
};