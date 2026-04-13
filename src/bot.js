const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const {
  getSession,
  saveSession,
  clearSession,
  saveRequest
} = require('./storage');
const {
  sendTextMessage,
  sendButtonsMessage
} = require('./whatsapp');
const {
  normalizeText,
  parseDate,
  isWeekend,
  calculateWorkingDays,
  describeHttpError
} = require('./utils');
const {
  getUserData,
  createPtoCase,
  uploadInputDocument,
  extractAppUid
} = require('./luranaApi');
const { downloadWhatsAppMediaById } = require('./whatsappMedia');

const STEPS = {
  MENU: 'MENU',
  USERNAME: 'USERNAME',
  CONFIRM_PROFILE: 'CONFIRM_PROFILE',
  START_DATE: 'START_DATE',
  END_DATE: 'END_DATE',
  REASON: 'REASON',
  CERT_MED: 'CERT_MED',
  CONFIRM_REQUEST: 'CONFIRM_REQUEST'
};

function buildInitialSession(phone) {
  return {
    phone,
    step: STEPS.MENU,
    startedAt: new Date().toISOString(),
    employee: null,
    request: {
      request_id: uuidv4(),
      startDate: '',
      endDate: '',
      reason: '',
      requestedDays: 0,
      certMedMediaId: '',
      certMedMimeType: '',
      certMedFilename: ''
    }
  };
}

function getUserInput(message) {
  const interactiveId = normalizeText(message.interactiveId);
  const text = normalizeText(message.text);
  return interactiveId || text;
}

function parseApiUser(data) {
  if (!data) return null;
  if (data.user) return data.user;
  if (data.data) return data.data;
  return data;
}

function employeeSummary(employee) {
  return [
    `Empleado: ${(employee.firstName || employee.userName || '').trim()} ${(employee.lastName || '').trim()}`.trim(),
    `Correo: ${employee.email || ''}`,
    `Username: ${employee.userName || ''}`
  ].filter(Boolean).join('\n');
}

function buildRequestSummary(session) {
  const employee = session.employee;
  const request = session.request;
  const certificateStatus = request.certMedMediaId
    ? `Adjuntado${request.certMedFilename ? `: ${request.certMedFilename}` : ''}`
    : 'No adjuntado';

  return [
    'Resumen de solicitud',
    '',
    `Empleado: ${(employee.firstName || employee.userName || '').trim()} ${(employee.lastName || '').trim()}`.trim(),
    `Correo: ${employee.email || ''}`,
    `Fecha inicio: ${request.startDate}`,
    `Fecha fin: ${request.endDate}`,
    `Dias solicitados: ${request.requestedDays}`,
    `Motivo: ${request.reason}`,
    `Certificado medico: ${certificateStatus}`
  ].join('\n');
}

function buildCreateCasePayload(employee, request) {
  return {
    pro_uid: config.luranaProUid,
    tas_uid: config.luranaTasUid,
    variables: [
      {
        userId: employee.userId || '',
        userName: employee.userName || '',
        firstName: employee.firstName || employee.userName || '',
        lastName: employee.lastName || '',
        email: employee.email || '',
        typeRequest: 1,
        daysHours: 1,
        typePermission: 3,
        reason: request.reason,
        startDate: request.startDate,
        endDate: request.endDate
      }
    ]
  };
}

function buildCertificatePrompt() {
  return [
    'Adjunta tu certificado medico como documento de WhatsApp.',
    'Si no aplica, pulsa Omitir o escribe "omitir".'
  ].join('\n');
}

function buildCertificateComment(session) {
  const requestId = session.request?.request_id || 'sin-request-id';
  const username = session.employee?.userName || 'sin-username';
  return `Certificado medico recibido por WhatsApp. request_id=${requestId}, user=${username}`;
}

function buildAttachmentWarning(errorOrDetail) {
  const detail =
    errorOrDetail?.status !== undefined || errorOrDetail?.isTimeout !== undefined
      ? errorOrDetail
      : describeHttpError(errorOrDetail);

  if (detail.isTimeout) {
    return 'La solicitud fue creada, pero la subida del certificado excedio el tiempo de espera.';
  }

  if (detail.status === 401 || detail.status === 403) {
    return 'La solicitud fue creada, pero Lurana rechazo el adjunto del certificado por autenticacion o permisos.';
  }

  if (detail.status === 404) {
    return 'La solicitud fue creada, pero no se encontro el endpoint o el recurso del adjunto en Lurana.';
  }

  return `La solicitud fue creada, pero no pude adjuntar el certificado (${detail.message}).`;
}

async function deleteTempFile(filePath) {
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
    console.log('[CERT_MED] Archivo temporal eliminado:', filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[CERT_MED] No se pudo eliminar el archivo temporal:', filePath, error.message);
    }
  }
}

async function moveToConfirmRequest(phone, session) {
  session.step = STEPS.CONFIRM_REQUEST;
  saveSession(phone, session);

  await sendButtonsMessage(
    phone,
    `${buildRequestSummary(session)}\n\nDeseas registrar la solicitud?`,
    [
      { id: 'request_confirm', title: 'Confirmar' },
      { id: 'cancel_flow', title: 'Cancelar' }
    ]
  );
}

function buildPromptForCurrentStep(step) {
  switch (step) {
    case STEPS.USERNAME:
      return 'Ahora escribe tu username corporativo.';
    case STEPS.CONFIRM_PROFILE:
      return 'Ahora confirma si los datos del usuario son correctos.';
    case STEPS.START_DATE:
      return 'Ahora escribe la fecha de inicio en formato DD-MM-YYYY.';
    case STEPS.END_DATE:
      return 'Ahora escribe la fecha de fin en formato DD-MM-YYYY.';
    case STEPS.REASON:
      return 'Ahora escribe el motivo de la solicitud.';
    case STEPS.CONFIRM_REQUEST:
      return 'Cuando quieras registrarla, pulsa Confirmar.';
    default:
      return 'Continua con el flujo.';
  }
}

async function captureCertificateInSession(phone, session, message) {
  if (!message.mediaId) {
    await sendTextMessage(phone, 'Recibi el documento, pero no encontre el mediaId. Intenta reenviarlo');
    return true;
  }

  session.request.certMedMediaId = message.mediaId;
  session.request.certMedMimeType = message.mimeType || message.mime_type || '';
  session.request.certMedFilename = message.filename || '';
  saveSession(phone, session);

  console.log('[CERT_MED] Documento recibido desde WhatsApp:', {
    phone,
    mediaId: session.request.certMedMediaId,
    filename: session.request.certMedFilename || null,
    mimeType: session.request.certMedMimeType || null
  });

  await sendTextMessage(phone, 'Certificado recibido');

  if (session.step === STEPS.CERT_MED || session.step === STEPS.CONFIRM_REQUEST) {
    await moveToConfirmRequest(phone, session);
    return true;
  }

  await sendTextMessage(phone, buildPromptForCurrentStep(session.step));
  return true;
}

async function attachCertificateIfNeeded(session, appUid) {
  if (!session.request.certMedMediaId) {
    return {
      skipped: true
    };
  }

  if (!appUid) {
    throw new Error('No se pudo extraer app_uid de la respuesta de createPtoCase');
  }

  if (!config.luranaCertInpDocUid) {
    throw new Error('LURANA_CERT_INP_DOC_UID is not configured');
  }

  if (!config.luranaTasUid) {
    throw new Error('LURANA_TAS_UID is not configured');
  }

  const mediaId = session.request.certMedMediaId;
  let download = null;
  let downloadedMedia = null;

  try {
    console.log('[CERT_MED] Descargando certificado medico:', {
      appUid,
      mediaId,
      filename: session.request.certMedFilename || null,
      mimeType: session.request.certMedMimeType || null
    });

    downloadedMedia = await downloadWhatsAppMediaById(
      mediaId,
      session.request.certMedFilename || `certificado-${session.request.request_id}`
    );
    download = {
      filePath: downloadedMedia.filePath,
      filename: downloadedMedia.meta.filename,
      size: downloadedMedia.meta.size
    };

    const upload = await uploadInputDocument(
      appUid,
      config.luranaCertInpDocUid,
      config.luranaTasUid,
      download.filePath,
      buildCertificateComment(session)
    );

    console.log('[CERT_MED] Certificado adjuntado en Lurana:', {
      appUid,
      mediaId,
      appDocUid: upload?.app_doc_uid || null
    });

    return {
      skipped: false,
      metadata: downloadedMedia.meta,
      download: {
        filename: download.filename,
        size: download.size
      },
      upload
    };
  } finally {
    await deleteTempFile(download?.filePath);
  }
}

async function sendMainMenu(to) {
  await sendButtonsMessage(
    to,
    `Hola.\nSoy el asistente de *${config.companyName}*.\n\nQue deseas hacer?`,
    [
      { id: 'menu_start', title: 'Nueva solicitud' },
      { id: 'menu_cancel', title: 'Cancelar' }
    ]
  );
}

async function processMessage(message) {
  const from = normalizeText(message.from);
  const input = getUserInput(message);
  const plainText = normalizeText(message.text);
  const inputLower = input.toLowerCase();

  if (!from) return;

  if (inputLower === 'cancelar' || input === 'menu_cancel' || input === 'cancel_flow') {
    clearSession(from);
    await sendTextMessage(from, 'Solicitud cancelada correctamente');
    return;
  }

  let session = getSession(from);

  if (!session) {
    session = buildInitialSession(from);
    saveSession(from, session);
    await sendMainMenu(from);
    return;
  }

  if (message.type === 'document' && session.step !== STEPS.MENU) {
    await captureCertificateInSession(from, session, message);
    return;
  }

  switch (session.step) {
    case STEPS.MENU:
      if (input !== 'menu_start' && inputLower !== 'nueva solicitud' && inputLower !== 'iniciar') {
        await sendMainMenu(from);
        return;
      }

      session.step = STEPS.USERNAME;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu username corporativo');
      return;

    case STEPS.USERNAME:
      if (!plainText) {
        await sendTextMessage(from, 'Debes escribir tu username');
        return;
      }

      try {
        const apiResponse = await getUserData(plainText);
        const employee = parseApiUser(apiResponse);

        if (!employee) {
          await sendTextMessage(from, 'No encontre un usuario con ese username. Intenta nuevamente');
          return;
        }

        session.employee = employee;
        session.step = STEPS.CONFIRM_PROFILE;
        saveSession(from, session);

        await sendButtonsMessage(
          from,
          `Encontre estos datos:\n\n${employeeSummary(employee)}\n\nSon correctos?`,
          [
            { id: 'profile_ok', title: 'Si' },
            { id: 'profile_retry', title: 'No' }
          ]
        );
      } catch (error) {
        console.error('[BOT][GET_USER] Error consultando getUserData:', describeHttpError(error));
        await sendTextMessage(from, 'No pude consultar tus datos en este momento');
      }
      return;

    case STEPS.CONFIRM_PROFILE:
      if (input === 'profile_retry') {
        session.employee = null;
        session.step = STEPS.USERNAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Perfecto. Escribe nuevamente tu username');
        return;
      }

      if (input !== 'profile_ok') {
        await sendTextMessage(from, 'Selecciona una opcion valida');
        return;
      }

      session.step = STEPS.START_DATE;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe la fecha de inicio en formato DD-MM-YYYY');
      return;

    case STEPS.START_DATE: {
      const start = parseDate(plainText);

      if (!start) {
        await sendTextMessage(from, 'Fecha invalida. Usa DD-MM-YYYY');
        return;
      }

      if (isWeekend(start)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana');
        return;
      }

      session.request.startDate = start.format('DD-MM-YYYY');
      session.step = STEPS.END_DATE;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe la fecha de fin en formato DD-MM-YYYY');
      return;
    }

    case STEPS.END_DATE: {
      const end = parseDate(plainText);
      const start = parseDate(session.request.startDate);

      if (!end || !start) {
        await sendTextMessage(from, 'Fecha invalida. Usa DD-MM-YYYY');
        return;
      }

      if (isWeekend(end)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana');
        return;
      }

      if (end.isBefore(start, 'day')) {
        await sendTextMessage(from, 'La fecha fin no puede ser menor a la fecha inicio');
        return;
      }

      const requestedDays = calculateWorkingDays(
        session.request.startDate,
        end.format('DD-MM-YYYY')
      );

      session.request.endDate = end.format('DD-MM-YYYY');
      session.request.requestedDays = requestedDays;
      session.step = STEPS.REASON;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe el motivo de tus vacaciones');
      return;
    }

    case STEPS.REASON:
      if (!plainText) {
        await sendTextMessage(from, 'Debes escribir un motivo');
        return;
      }

      session.request.reason = plainText;
      session.step = STEPS.CERT_MED;
      saveSession(from, session);

      await sendButtonsMessage(
        from,
        buildCertificatePrompt(),
        [
          { id: 'cert_skip', title: 'Omitir' },
          { id: 'cancel_flow', title: 'Cancelar' }
        ]
      );
      return;

    case STEPS.CERT_MED:
      if (input === 'cert_skip' || inputLower === 'omitir') {
        session.request.certMedMediaId = '';
        session.request.certMedMimeType = '';
        session.request.certMedFilename = '';
        await moveToConfirmRequest(from, session);
        return;
      }

      await sendTextMessage(
        from,
        'Adjunta el certificado como documento de WhatsApp o escribe "omitir" para continuar sin archivo'
      );
      return;

    case STEPS.CONFIRM_REQUEST:
      if (input !== 'request_confirm') {
        await sendTextMessage(from, 'Selecciona Confirmar o Cancelar');
        return;
      }

      try {
        const payload = buildCreateCasePayload(session.employee, session.request);
        const apiResponse = await createPtoCase(payload);
        const appUid = extractAppUid(apiResponse);
        let certificateResult = null;
        let attachmentError = null;

        console.log('[LURANA_CASE] Caso creado:', {
          requestId: session.request.request_id,
          appUid: appUid || null
        });

        if (session.request.certMedMediaId) {
          try {
            certificateResult = await attachCertificateIfNeeded(session, appUid);
          } catch (error) {
            attachmentError = describeHttpError(error);
            console.error('[CERT_MED] Error adjuntando certificado:', attachmentError);
          }
        }

        saveRequest(session.request.request_id, {
          local_request_id: session.request.request_id,
          phone: from,
          app_uid: appUid || null,
          employee: session.employee,
          request: session.request,
          lurana_payload: payload,
          lurana_response: apiResponse,
          cert_med_result: certificateResult,
          cert_med_error: attachmentError
        });

        clearSession(from);

        let confirmationMessage = [
          'Solicitud registrada correctamente.',
          '',
          `Dias solicitados: ${session.request.requestedDays}`
        ];

        if (appUid) {
          confirmationMessage.push(`Caso: ${appUid}`);
        }

        if (certificateResult && !certificateResult.skipped) {
          confirmationMessage.push('Certificado medico adjuntado correctamente.');
        }

        if (attachmentError) {
          confirmationMessage.push('');
          confirmationMessage.push(`Aviso: ${buildAttachmentWarning(attachmentError)}`);
        }

        await sendTextMessage(from, confirmationMessage.join('\n'));
      } catch (error) {
        console.error('[LURANA_CASE] Error creando caso:', describeHttpError(error));
        await sendTextMessage(
          from,
          'Ocurrio un error al crear el caso. Revisa token, permisos y payload enviado a Lurana.'
        );
      }
      return;

    default:
      clearSession(from);
      await sendMainMenu(from);
  }
}

module.exports = {
  processMessage
};
