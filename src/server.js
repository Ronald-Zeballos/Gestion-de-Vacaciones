const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const config = require('./config');
const { ensureDirectories } = require('./storage');
const { processMessage } = require('./bot');
const {
  getUserData,
  createPtoCase,
  uploadInputDocument,
  extractAppUid
} = require('./luranaApi');
const { getMediaMeta, downloadMediaToTemp } = require('./whatsappMedia');
const { describeHttpError, getHttpStatusFromError } = require('./utils');

const app = express();

app.use(express.json({ limit: '10mb' }));
ensureDirectories();

function buildErrorResponse(error) {
  return {
    error: describeHttpError(error)
  };
}

async function deleteFileQuietly(filePath) {
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
    console.log('[TMP] Archivo temporal eliminado:', filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[TMP] No se pudo eliminar el archivo temporal:', filePath, error.message);
    }
  }
}

function normalizeIncomingMessage(message) {
  const from = message?.from || '';
  const type = message?.type || '';

  const payload = {
    from,
    type,
    text: '',
    interactiveId: '',
    interactiveTitle: '',
    mediaId: '',
    mimeType: '',
    mime_type: '',
    filename: '',
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

  if (type === 'document') {
    payload.text = message.document?.caption || '';
    payload.mediaId = message.document?.id || '';
    payload.mimeType = message.document?.mime_type || '';
    payload.mime_type = message.document?.mime_type || '';
    payload.filename = message.document?.filename || '';
  }

  return payload;
}

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
    res.json({
      ok: true,
      data
    });
  } catch (error) {
    console.error('[TEST][LURANA_USER] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.post('/test-lurana-case', async (req, res) => {
  try {
    const data = await createPtoCase(req.body);
    const appUid = extractAppUid(data);

    res.json({
      ok: true,
      appUid,
      data
    });
  } catch (error) {
    console.error('[TEST][LURANA_CASE] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.get('/test-wa-media/:mediaId', async (req, res) => {
  const keepFile = req.query.keepFile === '1';
  let download = null;

  try {
    const mediaId = req.params.mediaId;
    const metadata = await getMediaMeta(mediaId);
    const filenameHint = req.query.filename || `wa-media-${mediaId}`;

    console.log('[TEST][WA_MEDIA] Descargando media:', { mediaId, filenameHint });
    download = await downloadMediaToTemp(metadata.url, filenameHint);

    const responsePayload = {
      ok: true,
      mediaId,
      metadata,
      download: {
        filename: path.basename(download.filePath),
        size: download.size,
        filePath: keepFile ? download.filePath : null
      },
      cleanedUp: !keepFile
    };

    if (!keepFile) {
      await deleteFileQuietly(download.filePath);
    }

    res.json(responsePayload);
  } catch (error) {
    await deleteFileQuietly(download?.filePath);
    console.error('[TEST][WA_MEDIA] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.post('/test-lurana-attach', async (req, res) => {
  const { appUid, mediaId, comment } = req.body || {};
  let download = null;

  if (!appUid || !mediaId) {
    return res.status(400).json({
      error: {
        message: 'appUid and mediaId are required'
      }
    });
  }

  try {
    const metadata = await getMediaMeta(mediaId);
    const filenameHint = req.body?.filename || `wa-media-${mediaId}`;

    console.log('[TEST][LURANA_ATTACH] Descargando media para adjuntar:', {
      appUid,
      mediaId,
      filenameHint
    });

    download = await downloadMediaToTemp(metadata.url, filenameHint);

    const upload = await uploadInputDocument(
      appUid,
      config.luranaCertInpDocUid,
      config.luranaTasUid,
      download.filePath,
      comment || `Certificado medico adjuntado desde /test-lurana-attach (${mediaId})`
    );

    res.json({
      ok: true,
      appUid,
      mediaId,
      metadata,
      download: {
        filename: path.basename(download.filePath),
        size: download.size
      },
      upload,
      cleanedUp: true
    });
  } catch (error) {
    console.error('[TEST][LURANA_ATTACH] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  } finally {
    await deleteFileQuietly(download?.filePath);
  }
});

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
    console.error('[WEBHOOK] Error:', describeHttpError(error));
    return res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Servidor activo en puerto ${config.port}`);
});
