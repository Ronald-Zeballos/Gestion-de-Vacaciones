const express = require('express');
const config = require('./config');
const { ensureDirectories } = require('./storage');
const { processMessage } = require('./bot');
const { getUserData, createPtoCase } = require('./luranaApi');

const app = express();

app.use(express.json({ limit: '10mb' }));
ensureDirectories();

app.get('/', (req, res) => {
  res.send('Servidor funcionando');
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'whatsapp-vacaciones-bot',
    port: config.port
  });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.get('/test-lurana-user/:username', async (req, res) => {
  try {
    const data = await getUserData(req.params.username);
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

app.post('/test-lurana-case', async (req, res) => {
  try {
    const data = await createPtoCase(req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.response?.data || error.message
    });
  }
});

function normalizeIncomingMessage(message) {
  const from = message?.from || '';
  const type = message?.type || '';

  const payload = {
    from,
    type,
    text: '',
    interactiveId: '',
    interactiveTitle: '',
    raw: message
  };

  if (type === 'text') {
    payload.text = message.text?.body || '';
  }

  if (type === 'button') {
    payload.text = message.button?.text || '';
    payload.interactiveId = message.button?.payload || '';
  }

  if (type === 'interactive') {
    const interactiveType = message.interactive?.type;

    if (interactiveType === 'button_reply') {
      payload.text = message.interactive?.button_reply?.title || '';
      payload.interactiveId = message.interactive?.button_reply?.id || '';
      payload.interactiveTitle = message.interactive?.button_reply?.title || '';
    }

    if (interactiveType === 'list_reply') {
      payload.text = message.interactive?.list_reply?.title || '';
      payload.interactiveId = message.interactive?.list_reply?.id || '';
      payload.interactiveTitle = message.interactive?.list_reply?.title || '';
    }
  }

  return payload;
}

app.post('/webhook', async (req, res) => {
  try {
    const entries = req.body?.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];

        for (const message of messages) {
          const normalized = normalizeIncomingMessage(message);
          await processMessage(normalized);
        }
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Servidor activo en puerto ${config.port}`);
});
