const fs = require('fs/promises');
const path = require('path');
const axios = require('axios');
const express = require('express');
const config = require('./config');
const {
  ensureDirectories,
  getRequest,
  findRequestByAppUid
} = require('./storage');
const {
  processMessage,
  createManagerReviewTestRequest,
  createManagerReviewRequestFromProcessmaker
} = require('./bot');
const {
  getUserData,
  getUserDataByPhone,
  createPtoCase,
  updatePtoData,
  listRecentCases,
  uploadInputDocument,
  extractAppUid,
  extractAppNumber
} = require('./luranaApi');
const { downloadWhatsAppMediaById } = require('./whatsappMedia');
const { describeHttpError, getHttpStatusFromError } = require('./utils');
const {
  getLastUserLookup,
  getLastCreateCase,
  getLastUpdatePtoData,
  getLastProcessmakerTrigger,
  getLastCasesQuery,
  getLastMedia,
  getLastIncoming,
  setLastIncoming,
  setLastProcessmakerTrigger,
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
    mediaMime: '',
    mediaFilename: '',
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
    payload.mediaMime = message.document?.mime_type || '';
    payload.mediaFilename = message.document?.filename || '';
    payload.mimeType = message.document?.mime_type || '';
    payload.mime_type = message.document?.mime_type || '';
    payload.filename = message.document?.filename || '';
  }

  if (type === 'image') {
    payload.text = message.image?.caption || '';
    payload.mediaId = message.image?.id || '';
    payload.mediaMime = message.image?.mime_type || '';
    payload.mimeType = message.image?.mime_type || '';
    payload.mime_type = message.image?.mime_type || '';
  }

  return payload;
}

async function fetchWhatsAppMediaMetadata(mediaId) {
  if (!mediaId) {
    throw new Error('mediaId is required');
  }

  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_TOKEN is not configured');
  }

  const response = await axios.get(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(mediaId)}`,
    {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`
      },
      timeout: 15000
    }
  );

  return response.data;
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

function getProcessmakerTriggerTokenFromRequest(req) {
  return String(
    req.headers['x-trigger-token'] ||
    req.headers['x-processmaker-token'] ||
    req.query.token ||
    req.body?.token ||
    ''
  ).trim();
}

function requireProcessmakerTriggerToken(req, res, next) {
  if (!config.processmakerTriggerToken) {
    return next();
  }

  const providedToken = getProcessmakerTriggerTokenFromRequest(req);

  if (providedToken && providedToken === config.processmakerTriggerToken) {
    return next();
  }

  return res.status(403).json({
    error: {
      message: 'Invalid trigger token'
    }
  });
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
    PROCESSMAKER_TRIGGER_TOKEN: maskValue(config.processmakerTriggerToken),
    LURANA_API_BASE_URL: config.luranaApiBaseUrl,
    LURANA_WORKSPACE: config.luranaWorkspace,
    LURANA_PRO_UID: config.luranaProUid,
    LURANA_TAS_UID: config.luranaTasUid,
    LURANA_CERT_INP_DOC_UID: config.luranaCertInpDocUid,
    LURANA_PHONE_LOOKUP_PATHS: config.luranaPhoneLookupPaths,
    LURANA_REVIEW_ACTION_VAR: config.luranaReviewActionVar,
    LURANA_REVIEW_ACTION_LABEL_VAR: config.luranaReviewActionLabelVar,
    LURANA_REVIEW_COMMENT_VAR: config.luranaReviewCommentVar,
    LURANA_TOKEN_URL: config.luranaTokenUrl,
    WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId,
    MANAGER_NOTIFICATION_NUMBER: maskValue(config.managerNotificationNumber),
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

function isTruthyFlag(value) {
  return ['1', 'true', 'yes', 'si', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getManagerDecisionCode(status) {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (normalizedStatus === 'approved') {
    return 1;
  }

  if (normalizedStatus === 'observed') {
    return 2;
  }

  if (normalizedStatus === 'rejected' || normalizedStatus === 'denied') {
    return 3;
  }

  return null;
}

function buildManagerReviewSummary(requestRecord) {
  if (!requestRecord) {
    return null;
  }

  const review = requestRecord.manager_review || {};
  const employee = requestRecord.employee || {};
  const request = requestRecord.request || {};
  const decisionCode = getManagerDecisionCode(review.status);

  return {
    local_request_id: requestRecord.local_request_id || request.request_id || null,
    app_uid: requestRecord.app_uid || null,
    app_number:
      requestRecord.app_number ||
      extractAppNumber(requestRecord.lurana_response) ||
      null,
    employee: {
      user_id: employee.userId || null,
      username: employee.userName || null,
      first_name: employee.firstName || null,
      last_name: employee.lastName || null,
      email: employee.email || null,
      phone: requestRecord.phone || null
    },
    request: {
      type_request_code: request.typeRequestCode ?? null,
      type_request_label: request.typeRequestLabel || null,
      time_unit_code: request.timeUnitCode ?? null,
      time_unit_label: request.timeUnitLabel || null,
      type_permission_code: request.typePermissionCode ?? null,
      type_permission_label: request.typePermissionLabel || null,
      start_date: request.startDate || null,
      end_date: request.endDate || null,
      start_time: request.startTime || null,
      end_time: request.endTime || null,
      requested_amount: request.requestedDays ?? 0,
      reason: request.reason || null,
      cert_med_attached: Boolean(request.certMedMediaId)
    },
    manager_review: {
      status: review.status || 'pending',
      decision: review.decision || null,
      decision_code: decisionCode,
      decision_display: review.decision_display || null,
      decision_comment: review.decision_comment || null,
      decision_at: review.decision_at || null,
      decided_by: review.decided_by || null,
      lurana_sync_status: review.lurana_sync_status || null,
      lurana_sync_at: review.lurana_sync_at || null,
      lurana_sync_payload: review.lurana_sync_payload || null,
      lurana_sync_response: review.lurana_sync_response || null,
      lurana_sync_error: review.lurana_sync_error || null,
      notification_status: review.notification_status || null,
      notified_at: review.notified_at || null,
      notified_to: review.notified_to || null,
      history: Array.isArray(review.history) ? review.history : []
    }
  };
}

function buildProcessMakerDecisionPayload(requestRecord) {
  const summary = buildManagerReviewSummary(requestRecord);

  if (!summary) {
    return null;
  }

  const variables = [];

  if (summary.manager_review.decision_code && summary.manager_review.decision) {
    const reviewVariables = {
      [config.luranaReviewActionVar]: summary.manager_review.decision_code,
      [config.luranaReviewActionLabelVar]: summary.manager_review.decision
    };

    if (summary.manager_review.decision_comment && summary.manager_review.decision_code !== 1) {
      reviewVariables[config.luranaReviewCommentVar] = summary.manager_review.decision_comment;
    }

    variables.push(reviewVariables);
  }

  return {
    appUid: summary.app_uid,
    appNumber: summary.app_number,
    userId: summary.employee.user_id,
    userName: summary.employee.username,
    variables,
    meta: {
      local_request_id: summary.local_request_id,
      manager_review_status: summary.manager_review.status,
      manager_review_decision: summary.manager_review.decision,
      manager_review_decision_code: summary.manager_review.decision_code,
      manager_review_decision_at: summary.manager_review.decision_at,
      manager_review_decided_by: summary.manager_review.decided_by
    }
  };
}

function resolveRequestRecord({ requestId, appUid }) {
  if (requestId) {
    return getRequest(requestId);
  }

  if (appUid) {
    return findRequestByAppUid(appUid);
  }

  return null;
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

app.get('/manager-review/request/:requestId', (req, res) => {
  const requestRecord = resolveRequestRecord({ requestId: req.params.requestId });

  if (!requestRecord) {
    return res.status(404).json({
      error: {
        message: 'Request not found'
      }
    });
  }

  return res.json({
    ok: true,
    source: 'request_id',
    data: buildManagerReviewSummary(requestRecord)
  });
});

app.get('/manager-review/case/:appUid', (req, res) => {
  const requestRecord = resolveRequestRecord({ appUid: req.params.appUid });

  if (!requestRecord) {
    return res.status(404).json({
      error: {
        message: 'Request not found for app_uid'
      }
    });
  }

  return res.json({
    ok: true,
    source: 'app_uid',
    data: buildManagerReviewSummary(requestRecord)
  });
});

app.get('/manager-review/request/:requestId/processmaker-payload', (req, res) => {
  const requestRecord = resolveRequestRecord({ requestId: req.params.requestId });

  if (!requestRecord) {
    return res.status(404).json({
      error: {
        message: 'Request not found'
      }
    });
  }

  return res.json({
    ok: true,
    source: 'request_id',
    data: buildProcessMakerDecisionPayload(requestRecord)
  });
});

app.get('/manager-review/case/:appUid/processmaker-payload', (req, res) => {
  const requestRecord = resolveRequestRecord({ appUid: req.params.appUid });

  if (!requestRecord) {
    return res.status(404).json({
      error: {
        message: 'Request not found for app_uid'
      }
    });
  }

  return res.json({
    ok: true,
    source: 'app_uid',
    data: buildProcessMakerDecisionPayload(requestRecord)
  });
});

app.all('/processmaker/trigger-ping', requireProcessmakerTriggerToken, (req, res) => {
  const payload = {
    method: req.method,
    query: req.query || {},
    body: req.body || {},
    headers: {
      'x-trigger-token': req.headers['x-trigger-token'] ? 'provided' : '',
      'x-processmaker-token': req.headers['x-processmaker-token'] ? 'provided' : ''
    }
  };

  setLastProcessmakerTrigger({
    type: 'ping',
    payload,
    result: {
      ok: true
    }
  });

  return res.json({
    ok: true,
    message: 'Trigger ping recibido correctamente',
    receivedAt: new Date().toISOString(),
    payload
  });
});

app.post('/processmaker/manager-review', requireProcessmakerTriggerToken, async (req, res) => {
  const requestPayload = req.body || {};

  try {
    const result = await createManagerReviewRequestFromProcessmaker(requestPayload);
    const responsePayload = {
      ok: true,
      message: 'Solicitud recibida desde ProcessMaker y enviada al jefe',
      requestId: result.requestRecord?.local_request_id || null,
      data: buildManagerReviewSummary(result.requestRecord),
      processmakerPayload: buildProcessMakerDecisionPayload(result.requestRecord),
      managerNotification: result.managerNotification
    };

    setLastProcessmakerTrigger({
      type: 'manager-review',
      payload: requestPayload,
      result: responsePayload
    });

    return res.json(responsePayload);
  } catch (error) {
    const detail = buildErrorResponse(error);

    setLastProcessmakerTrigger({
      type: 'manager-review',
      payload: requestPayload,
      error: detail.error
    });

    console.error('[PROCESSMAKER][MANAGER_REVIEW] Error:', describeHttpError(error));
    return res.status(getHttpStatusFromError(error)).json(detail);
  }
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

app.get('/test-lurana-phone/:phone', async (req, res) => {
  try {
    const requestedPhone = String(req.params.phone || '').trim();
    const data = await getUserDataByPhone(requestedPhone);
    const lookup = getLastUserLookup();

    if (!data) {
      return res.status(404).json({
        ok: false,
        requestedPhone,
        lookup,
        error: {
          message: 'No se encontro un usuario para ese numero'
        }
      });
    }

    return res.json({
      ok: true,
      requestedPhone,
      lookup,
      data
    });
  } catch (error) {
    console.error('[TEST][LURANA_PHONE] Error:', describeHttpError(error));
    return res.status(getHttpStatusFromError(error)).json({
      ...buildErrorResponse(error),
      requestedPhone: String(req.params.phone || '').trim(),
      lookup: getLastUserLookup()
    });
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

app.get('/debug/last-update-ptodata', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastUpdatePtoData() || buildEmptyPayload('lastUpdatePtoData')
  });
});

app.get('/debug/last-processmaker-trigger', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastProcessmakerTrigger() || buildEmptyPayload('lastProcessmakerTrigger')
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

app.get('/debug/last-incoming', requireDebugMode, (req, res) => {
  res.json({
    ok: true,
    data: getLastIncoming() || buildEmptyPayload('lastIncoming')
  });
});

app.get('/debug/wa-media-url/:mediaId', requireDebugMode, async (req, res) => {
  try {
    const data = await fetchWhatsAppMediaMetadata(req.params.mediaId);

    res.json({
      ok: true,
      data: {
        id: data?.id || req.params.mediaId,
        url: data?.url || '',
        mime_type: data?.mime_type || '',
        file_size: data?.file_size || null
      }
    });
  } catch (error) {
    console.error('[DEBUG][WA_MEDIA_URL] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
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
    const appNumber = extractAppNumber(data);
    const shouldNotifyManager =
      isTruthyFlag(req.query.notifyManager) ||
      isTruthyFlag(req.body?.notifyManager) ||
      isTruthyFlag(req.body?.notify_manager);
    let managerReview = null;

    if (shouldNotifyManager) {
      const result = await createManagerReviewRequestFromProcessmaker({
        ...req.body,
        appUid: appUid || req.body?.appUid || req.body?.app_uid || '',
        appNumber: appNumber || req.body?.appNumber || req.body?.app_number || '',
        lurana_response: data
      });

      managerReview = {
        requestId: result.requestRecord?.local_request_id || null,
        data: buildManagerReviewSummary(result.requestRecord),
        processmakerPayload: buildProcessMakerDecisionPayload(result.requestRecord),
        managerNotification: result.managerNotification
      };
    }

    res.json({
      ok: true,
      appUid,
      appNumber,
      data,
      managerReview
    });
  } catch (error) {
    console.error('[TEST][LURANA_CASE] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.post('/test-lurana-review', async (req, res) => {
  try {
    const data = await updatePtoData(req.body);

    res.json({
      ok: true,
      data
    });
  } catch (error) {
    console.error('[TEST][LURANA_REVIEW] Error:', describeHttpError(error));
    res.status(getHttpStatusFromError(error)).json(buildErrorResponse(error));
  }
});

app.post('/test-manager-notification', async (req, res) => {
  try {
    const result = await createManagerReviewTestRequest(req.body || {});

    res.json({
      ok: true,
      message: 'Solicitud de prueba enviada al jefe',
      requestId: result.requestRecord?.local_request_id || null,
      data: buildManagerReviewSummary(result.requestRecord),
      processmakerPayload: buildProcessMakerDecisionPayload(result.requestRecord),
      managerNotification: result.managerNotification
    });
  } catch (error) {
    console.error('[TEST][MANAGER_NOTIFICATION] Error:', describeHttpError(error));
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
          setLastIncoming({
            from: normalized.from,
            type: normalized.type,
            messageId: normalized.messageId,
            text: normalized.text,
            interactiveId: normalized.interactiveId,
            mediaId: normalized.mediaId,
            mediaMime: normalized.mediaMime,
            mediaFilename: normalized.mediaFilename,
            raw: normalized.raw
          });
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
