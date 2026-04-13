const fs = require('fs/promises');
const path = require('path');
const express = require('express');
const config = require('./config');
const { ensureDirectories } = require('./storage');
const { processMessage } = require('./bot');
const {
  getUserData,
  createPtoCase,
  listRecentCases,
  uploadInputDocument,
  extractAppUid
} = require('./luranaApi');
const { downloadWhatsAppMediaById } = require('./whatsappMedia');
const { describeHttpError, getHttpStatusFromError } = require('./utils');
const {
  getLastUserLookup,
  getLastCreateCase,
  getLastCasesQuery,
  getLastMedia,
  clear
} = require('./debugStore');

const app = express();

app.use(express.json({ limit: '10mb' }));
ensureDirectories();

const isDebugModeEnabled = process.env.DEBUG_MODE === 'true';

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
    messageId: message?.id || '',
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
    port: config.port,
    debugMode: isDebugModeEnabled
  });
});

function requireDebugMode(req, res, next) {
  if (!isDebugModeEnabled) {
    return res.status(404).json({
      error: {
        message: 'Not found'
      }
    });
  }

  return next();
}

function listRegisteredRoutes() {
  const stack = app?._router?.stack || [];
  const routes = [];

  for (const layer of stack) {
    if (!layer.route) {
      continue;
    }

    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());

    routes.push({
      path: layer.route.path,
      methods
    });
  }

  return routes;
}

function maskValue(value, visible = 4) {
  const normalized = String(value || '');

  if (!normalized) {
    return '';
  }

  if (normalized.length <= visible) {
    return '*'.repeat(normalized.length);
  }

  return `***${normalized.slice(-visible)}`;
}

function buildDebugEnvPayload() {
  return {
    DEBUG_MODE: process.env.DEBUG_MODE || '',
    NODE_ENV: process.env.NODE_ENV || '',
    PORT: process.env.PORT || '',
    LURANA_API_BASE_URL: config.luranaApiBaseUrl,
    LURANA_WORKSPACE: config.luranaWorkspace,
    LURANA_PRO_UID: config.luranaProUid,
    LURANA_TAS_UID: config.luranaTasUid,
    LURANA_CERT_INP_DOC_UID: config.luranaCertInpDocUid,
    LURANA_TOKEN_URL: config.luranaTokenUrl,
    WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId,
    LURANA_CLIENT_ID: maskValue(config.luranaClientId),
    LURANA_CLIENT_SECRET: maskValue(config.luranaClientSecret),
    LURANA_USER: config.luranaUser,
    LURANA_PASSWORD: maskValue(config.luranaPassword),
    WHATSAPP_TOKEN: maskValue(config.whatsappToken)
  };
}

function buildEmptyPayload(label) {
  return {
    message: `${label} empty`
  };
}

function extractCasesArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.cases)) {
    return payload.cases;
  }

  if (Array.isArray(payload?.response?.data)) {
    return payload.response.data;
  }

  if (Array.isArray(payload?.response?.data?.data)) {
    return payload.response.data.data;
  }

  return [];
}

function getCaseProUid(item) {
  return (
    item?.pro_uid ||
    item?.PRO_UID ||
    item?.process?.pro_uid ||
    item?.process?.PRO_UID ||
    item?.processUid ||
    item?.process_uid ||
    ''
  );
}

function mapCaseSummary(item) {
  return {
    app_uid: item?.app_uid || item?.APP_UID || item?.appUid || null,
    app_number: item?.app_number || item?.APP_NUMBER || item?.case_number || item?.caseNumber || null,
    pro_uid: getCaseProUid(item) || null,
    current_task:
      item?.current_task ||
      item?.tas_title ||
      item?.TAS_TITLE ||
      item?.task_title ||
      item?.del_current_tas_title ||
      null,
    assigned_user:
      item?.assigned_user ||
      item?.usr_username ||
      item?.USR_USERNAME ||
      item?.del_thread_status ||
      item?.delegation_user ||
      null,
    app_status: item?.app_status || item?.APP_STATUS || null,
    app_create_date: item?.app_create_date || item?.APP_CREATE_DATE || null,
    raw: item
  };
}

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

app.get('/debug/routes', requireDebugMode, (req, res) => {
  const routes = listRegisteredRoutes();
  res.json({
    ok: true,
    count: routes.length,
    routes
  });
});

app.get('/routes', requireDebugMode, (req, res) => {
  const routes = listRegisteredRoutes();
  res.json({
    ok: true,
    count: routes.length,
    routes
  });
});

app.get('/debug/env', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    env: buildDebugEnvPayload()
  });
});

app.get('/debug/last-userlookup', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastUserLookup() || buildEmptyPayload('lastUserLookup')
  });
});

app.get('/debug/last-createcase', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastCreateCase() || buildEmptyPayload('lastCreateCase')
  });
});

app.get('/debug/last-casesquery', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastCasesQuery() || buildEmptyPayload('lastCasesQuery')
  });
});

app.get('/debug/last-media', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastMedia() || buildEmptyPayload('lastMedia')
  });
});

app.get('/debug/clear', requireDebugMode, (req, res) => {
  clear();
  res.json({
    ok: true,
    cleared: true
  });
});

app.get('/debug/cases/recent', requireDebugMode, async (req, res) => {
  try {
    const rawResponse = await listRecentCases(config.luranaProUid, 20);
    const allCases = extractCasesArray(rawResponse);
    const filteredCases = config.luranaProUid
      ? allCases.filter((item) => getCaseProUid(item) === config.luranaProUid)
      : allCases;

    res.json({
      ok: true,
      proUid: config.luranaProUid || null,
      totalReceived: allCases.length,
      totalFiltered: filteredCases.length,
      cases: filteredCases.map(mapCaseSummary),
      raw: rawResponse
    });
  } catch (error) {
    console.error('[DEBUG][CASES_RECENT] Error:', describeHttpError(error));
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
  let downloadedMedia = null;

  try {
    const mediaId = req.params.mediaId;
    const filenameHint = req.query.filename || `wa-media-${mediaId}`;

    console.log('[TEST][WA_MEDIA] Descargando media:', { mediaId, filenameHint });
    downloadedMedia = await downloadWhatsAppMediaById(mediaId, filenameHint);

    const responsePayload = {
      ok: true,
      mediaId,
      metadata: downloadedMedia.meta,
      download: {
        filename: path.basename(downloadedMedia.filePath),
        size: downloadedMedia.meta.size,
        filePath: keepFile ? downloadedMedia.filePath : null
      },
      cleanedUp: !keepFile
    };

    if (!keepFile) {
      await deleteFileQuietly(downloadedMedia.filePath);
    }

    res.json(responsePayload);
  } catch (error) {
    await deleteFileQuietly(downloadedMedia?.filePath);
    console.error('[TEST][WA_MEDIA] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.post('/test-lurana-attach', async (req, res) => {
  const { appUid, mediaId, comment } = req.body || {};
  let downloadedMedia = null;

  if (!appUid || !mediaId) {
    return res.status(400).json({
      error: {
        message: 'appUid and mediaId are required'
      }
    });
  }

  try {
    const filenameHint = req.body?.filename || `wa-media-${mediaId}`;

    console.log('[TEST][LURANA_ATTACH] Descargando media para adjuntar:', {
      appUid,
      mediaId,
      filenameHint
    });

    downloadedMedia = await downloadWhatsAppMediaById(mediaId, filenameHint);

    const upload = await uploadInputDocument(
      appUid,
      config.luranaCertInpDocUid,
      config.luranaTasUid,
      downloadedMedia.filePath,
      comment || `Certificado medico adjuntado desde /test-lurana-attach (${mediaId})`
    );

    res.json({
      ok: true,
      appUid,
      mediaId,
      metadata: downloadedMedia.meta,
      download: {
        filename: path.basename(downloadedMedia.filePath),
        size: downloadedMedia.meta.size
      },
      upload,
      cleanedUp: true
    });
  } catch (error) {
    console.error('[TEST][LURANA_ATTACH] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  } finally {
    await deleteFileQuietly(downloadedMedia?.filePath);
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
  console.log(`[DEBUG] Endpoints de debug ${isDebugModeEnabled ? 'habilitados' : 'deshabilitados'}`);
});
