const axios = require('axios');
const config = require('./config');

async function sendRequest(payload) {
  if (!config.whatsappToken || !config.phoneNumberId) {
    console.log('[SIMULADO] payload saliente:', JSON.stringify(payload, null, 2));
    return;
  }

  const url = `https://graph.facebook.com/v23.0/${config.phoneNumberId}/messages`;

  try {
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('[WHATSAPP] Error enviando mensaje:', {
      status: error.response?.status || null,
      data: error.response?.data || null,
      message: error.message
    });
    throw error;
  }
}

async function sendTextMessage(to, body) {
  return sendRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body
    }
  });
}

async function sendButtonsMessage(to, body, buttons) {
  return sendRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: body
      },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title.slice(0, 20)
          }
        }))
      }
    }
  });
}

async function sendListMessage(to, body, buttonText, sections) {
  return sendRequest({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: {
        text: body
      },
      action: {
        button: buttonText.slice(0, 20),
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
