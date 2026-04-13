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
  getProfile,
  saveProfile,
  clearProfile
} = require('./profiles');
const {
  sendTextMessage,
  sendButtonsMessage,
  sendListMessage
} = require('./whatsapp');
const {
  DATE_FORMAT,
  normalizeText,
  parseDate,
  parseDateOptionId,
  isWeekend,
  calculateWorkingDays,
  buildNextWorkingDaysOptions,
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
  START_DATE_PICK: 'START_DATE_PICK',
  END_DATE_PICK: 'END_DATE_PICK',
  REASON: 'REASON',
  CERT_MED: 'CERT_MED',
  CONFIRM_REQUEST: 'CONFIRM_REQUEST'
};

function createEmptyRequest() {
  return {
    request_id: uuidv4(),
    startDate: '',
    endDate: '',
    reason: '',
    requestedDays: 0,
    certMedMediaId: '',
    certMedMimeType: '',
    certMedFilename: ''
  };
}

function buildInitialSession(phone) {
  return {
    phone,
    step: STEPS.MENU,
    startedAt: new Date().toISOString(),
    employee: null,
    request: createEmptyRequest(),
    lastCreateError: null
  };
}

function resetRequestState(session) {
  session.request = createEmptyRequest();
  session.lastCreateError = null;
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

function hydrateEmployee(rawEmployee, username) {
  if (!rawEmployee) return null;

  return {
    ...rawEmployee,
    userName: normalizeText(username) || normalizeText(rawEmployee.userName),
    userId: rawEmployee.userId || rawEmployee.id || ''
  };
}

function employeeSummary(employee) {
  return [
    `Empleado: ${(employee.firstName || employee.userName || '').trim()} ${(employee.lastName || '').trim()}`.trim(),
    `Correo: ${employee.email || ''}`,
    `Username: ${employee.userName || ''}`
  ].filter(Boolean).join('\n');
}

function getEmployeeDisplayName(employee) {
  return normalizeText(employee?.firstName) || normalizeText(employee?.userName) || 'de nuevo';
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

function buildCreateErrorMessage(errorDetail) {
  const detail =
    errorDetail?.status !== undefined || errorDetail?.isTimeout !== undefined
      ? errorDetail
      : describeHttpError(errorDetail);

  const lines = [
    'No pude registrar la solicitud en Lurana.',
    `Detalle: ${detail.message}`
  ];

  if (detail.isTimeout) {
    lines.push('La conexion excedio el tiempo de espera.');
  }

  lines.push('', 'Puedes reintentar o volver al menu.');
  return lines.join('\n');
}

function buildProfilePayload(employee) {
  return {
    username: employee.userName || '',
    firstName: employee.firstName || '',
    lastName: employee.lastName || '',
    email: employee.email || ''
  };
}

function buildDateSections(options) {
  const sections = [];

  for (let index = 0; index < options.length; index += 10) {
    const chunk = options.slice(index, index + 10);
    sections.push({
      title: sections.length === 0 ? 'Proximos dias' : `Mas opciones ${index + 1}-${index + chunk.length}`,
      rows: chunk.map((option) => ({
        id: option.id,
        title: option.title,
        description: option.description || ''
      }))
    });
  }

  return sections;
}

function parseSelectedDate(input, plainText) {
  return parseDateOptionId(input) || parseDate(plainText);
}

async function persistEmployeeProfile(phone, employee) {
  if (!employee?.userName) return;
  saveProfile(phone, buildProfilePayload(employee));
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

async function sendMainMenu(to, session, introText = '') {
  const employee = session?.employee || null;
  const lines = [];

  if (introText) {
    lines.push(introText);
  } else if (employee) {
    lines.push(`Hola ${getEmployeeDisplayName(employee)}.`);
  } else {
    lines.push('Hola.');
  }

  lines.push(`Soy el asistente de *${config.companyName}*.`);

  if (employee) {
    lines.push(`Perfil activo: ${employee.userName || employee.email || 'sin username'}`);
  }

  lines.push('', 'Que deseas hacer?');

  const buttons = employee
    ? [
        { id: 'menu_start', title: 'Nueva solicitud' },
        { id: 'change_user', title: 'Cambiar usuario' },
        { id: 'exit_flow', title: 'Salir' }
      ]
    : [
        { id: 'menu_start', title: 'Nueva solicitud' },
        { id: 'exit_flow', title: 'Salir' }
      ];

  await sendButtonsMessage(to, lines.join('\n'), buttons);
}

async function sendStartDatePicker(to, session) {
  session.step = STEPS.START_DATE_PICK;
  session.lastCreateError = null;
  saveSession(to, session);

  const sections = buildDateSections(buildNextWorkingDaysOptions(14));
  await sendListMessage(
    to,
    'Elige la fecha de inicio.\nSi lo prefieres, tambien puedes escribirla como DD-MM-YYYY.',
    'Ver fechas',
    sections
  );
}

async function sendEndDatePicker(to, session) {
  session.step = STEPS.END_DATE_PICK;
  session.lastCreateError = null;
  saveSession(to, session);

  const sections = buildDateSections(buildNextWorkingDaysOptions(14, session.request.startDate));
  await sendListMessage(
    to,
    `Elige la fecha de fin.\nFecha de inicio seleccionada: ${session.request.startDate}`,
    'Ver fechas',
    sections
  );
}

async function moveToConfirmRequest(phone, session) {
  session.step = STEPS.CONFIRM_REQUEST;
  session.lastCreateError = null;
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

async function sendCreateRetryOptions(phone, detail) {
  await sendButtonsMessage(
    phone,
    buildCreateErrorMessage(detail),
    [
      { id: 'retry_create', title: 'Reintentar' },
      { id: 'menu_start', title: 'Menu' },
      { id: 'cancel_flow', title: 'Cancelar' }
    ]
  );
}

async function sendPostSuccessOptions(phone, message) {
  await sendButtonsMessage(
    phone,
    `${message}\n\nQue deseas hacer ahora?`,
    [
      { id: 'menu_start', title: 'Nueva solicitud' },
      { id: 'exit_flow', title: 'Salir' }
    ]
  );
}

async function resumeCurrentStep(phone, session) {
  switch (session.step) {
    case STEPS.USERNAME:
      await sendTextMessage(phone, 'Escribe tu username corporativo');
      return;

    case STEPS.CONFIRM_PROFILE:
      await sendButtonsMessage(
        phone,
        `Encontre estos datos:\n\n${employeeSummary(session.employee)}\n\nSon correctos?`,
        [
          { id: 'profile_ok', title: 'Si' },
          { id: 'profile_retry', title: 'No' }
        ]
      );
      return;

    case STEPS.START_DATE_PICK:
      await sendStartDatePicker(phone, session);
      return;

    case STEPS.END_DATE_PICK:
      await sendEndDatePicker(phone, session);
      return;

    case STEPS.REASON:
      await sendTextMessage(phone, 'Escribe el motivo de tus vacaciones');
      return;

    case STEPS.CERT_MED:
      await sendButtonsMessage(
        phone,
        buildCertificatePrompt(),
        [
          { id: 'cert_skip', title: 'Omitir' },
          { id: 'cancel_flow', title: 'Cancelar' }
        ]
      );
      return;

    case STEPS.CONFIRM_REQUEST:
      if (session.lastCreateError) {
        await sendCreateRetryOptions(phone, session.lastCreateError);
        return;
      }

      await moveToConfirmRequest(phone, session);
      return;

    case STEPS.MENU:
    default:
      await sendMainMenu(phone, session);
  }
}

async function captureCertificateInSession(phone, session, message) {
  if (!message.mediaId) {
    await sendTextMessage(phone, 'Recibi el documento, pero no encontre el mediaId. Intenta reenviarlo');
    return;
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

  if (session.step === STEPS.CERT_MED) {
    await moveToConfirmRequest(phone, session);
    return;
  }

  await resumeCurrentStep(phone, session);
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

async function resetConversationToMenu(phone, employee = null, introText = '') {
  if (employee?.userName) {
    await persistEmployeeProfile(phone, employee);
  }

  clearSession(phone);

  const session = buildInitialSession(phone);
  if (employee) {
    session.employee = employee;
  }

  saveSession(phone, session);

  if (introText) {
    await sendTextMessage(phone, introText);
  }

  await sendMainMenu(phone, session);
}

async function exitConversation(phone, session) {
  if (session?.employee?.userName) {
    await persistEmployeeProfile(phone, session.employee);
  }

  clearSession(phone);
  await sendTextMessage(phone, 'Hasta luego. Guarde tu perfil para la proxima.');
}

async function restoreSessionFromProfile(phone) {
  const profile = getProfile(phone);

  if (!profile?.username) {
    return null;
  }

  const apiResponse = await getUserData(profile.username);
  const employee = hydrateEmployee(parseApiUser(apiResponse), profile.username);

  if (!employee) {
    throw new Error('No se pudo reconstruir el perfil guardado');
  }

  const session = buildInitialSession(phone);
  session.employee = employee;
  saveSession(phone, session);
  await persistEmployeeProfile(phone, employee);

  return {
    profile,
    session
  };
}

async function processMessage(message) {
  const from = normalizeText(message.from);
  const input = getUserInput(message);
  const plainText = normalizeText(message.text);
  const inputLower = input.toLowerCase();

  if (!from) return;

  let session = getSession(from);

  if (session?.lastCreateError && (
    input === 'menu_start' ||
    input === 'cancel_flow' ||
    inputLower === 'cancelar'
  )) {
    await resetConversationToMenu(from, session.employee, 'Volvimos al menu principal.');
    return;
  }

  if (input === 'exit_flow' || inputLower === 'salir') {
    await exitConversation(from, session);
    return;
  }

  if (inputLower === 'cancelar' || input === 'menu_cancel' || input === 'cancel_flow') {
    if (session?.employee?.userName) {
      await persistEmployeeProfile(from, session.employee);
    }

    clearSession(from);
    await sendTextMessage(from, 'Solicitud cancelada correctamente');
    return;
  }

  if (!session) {
    try {
      const restored = await restoreSessionFromProfile(from);

      if (restored?.session) {
        await sendMainMenu(
          from,
          restored.session,
          `Hola ${getEmployeeDisplayName(restored.session.employee)}. Te reconoci por tu perfil guardado.`
        );
        return;
      }
    } catch (error) {
      console.error('[PROFILE] Error restaurando perfil:', describeHttpError(error));
    }

    session = buildInitialSession(from);
    saveSession(from, session);
    await sendMainMenu(from, session);
    return;
  }

  if (message.type === 'document' && session.step !== STEPS.MENU) {
    await captureCertificateInSession(from, session, message);
    return;
  }

  switch (session.step) {
    case STEPS.MENU:
      if (input === 'change_user' || inputLower === 'cambiar usuario') {
        clearProfile(from);
        session.employee = null;
        resetRequestState(session);
        session.step = STEPS.USERNAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Perfil olvidado. Escribe tu username corporativo');
        return;
      }

      if (input !== 'menu_start' && inputLower !== 'nueva solicitud' && inputLower !== 'iniciar') {
        await sendMainMenu(from, session);
        return;
      }

      resetRequestState(session);

      if (session.employee) {
        await sendStartDatePicker(from, session);
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
        const employee = hydrateEmployee(parseApiUser(apiResponse), plainText);

        if (!employee) {
          await sendTextMessage(from, 'No encontre un usuario con ese username. Intenta nuevamente');
          return;
        }

        session.employee = employee;
        session.step = STEPS.CONFIRM_PROFILE;
        session.lastCreateError = null;
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
        clearProfile(from);
        session.employee = null;
        resetRequestState(session);
        session.step = STEPS.USERNAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Perfecto. Escribe nuevamente tu username');
        return;
      }

      if (input !== 'profile_ok') {
        await sendTextMessage(from, 'Selecciona una opcion valida');
        return;
      }

      await persistEmployeeProfile(from, session.employee);
      resetRequestState(session);
      await sendStartDatePicker(from, session);
      return;

    case STEPS.START_DATE_PICK: {
      const start = parseSelectedDate(input, plainText);

      if (!start) {
        await sendTextMessage(from, 'Selecciona una fecha de la lista o escribe DD-MM-YYYY');
        await sendStartDatePicker(from, session);
        return;
      }

      if (isWeekend(start)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana');
        await sendStartDatePicker(from, session);
        return;
      }

      session.request.startDate = start.format(DATE_FORMAT);
      session.request.endDate = '';
      session.request.requestedDays = 0;
      await sendEndDatePicker(from, session);
      return;
    }

    case STEPS.END_DATE_PICK: {
      const end = parseSelectedDate(input, plainText);
      const start = parseDate(session.request.startDate);

      if (!end || !start) {
        await sendTextMessage(from, 'Selecciona una fecha de la lista o escribe DD-MM-YYYY');
        await sendEndDatePicker(from, session);
        return;
      }

      if (isWeekend(end)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana');
        await sendEndDatePicker(from, session);
        return;
      }

      if (end.isBefore(start, 'day')) {
        await sendTextMessage(from, 'La fecha fin no puede ser menor a la fecha inicio');
        await sendEndDatePicker(from, session);
        return;
      }

      session.request.endDate = end.format(DATE_FORMAT);
      session.request.requestedDays = calculateWorkingDays(
        session.request.startDate,
        session.request.endDate
      );
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
      session.lastCreateError = null;
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
      if (input !== 'request_confirm' && input !== 'retry_create') {
        if (session.lastCreateError) {
          await sendCreateRetryOptions(from, session.lastCreateError);
        } else {
          await sendTextMessage(from, 'Selecciona Confirmar o Cancelar');
        }
        return;
      }

      try {
        const requestSnapshot = { ...session.request };
        const payload = buildCreateCasePayload(session.employee, requestSnapshot);
        const apiResponse = await createPtoCase(payload);
        const appUid = extractAppUid(apiResponse);
        let certificateResult = null;
        let attachmentError = null;

        console.log('[LURANA_CASE] Caso creado:', {
          requestId: requestSnapshot.request_id,
          appUid: appUid || null
        });

        if (requestSnapshot.certMedMediaId) {
          try {
            certificateResult = await attachCertificateIfNeeded(
              { ...session, request: requestSnapshot },
              appUid
            );
          } catch (error) {
            attachmentError = describeHttpError(error);
            console.error('[CERT_MED] Error adjuntando certificado:', attachmentError);
          }
        }

        saveRequest(requestSnapshot.request_id, {
          local_request_id: requestSnapshot.request_id,
          phone: from,
          app_uid: appUid || null,
          employee: session.employee,
          request: requestSnapshot,
          lurana_payload: payload,
          lurana_response: apiResponse,
          cert_med_result: certificateResult,
          cert_med_error: attachmentError
        });

        await persistEmployeeProfile(from, session.employee);

        const confirmationLines = [
          'Solicitud registrada correctamente.',
          '',
          `Dias solicitados: ${requestSnapshot.requestedDays}`
        ];

        if (appUid) {
          confirmationLines.push(`Caso: ${appUid}`);
        }

        if (certificateResult && !certificateResult.skipped) {
          confirmationLines.push('Certificado medico adjuntado correctamente.');
        }

        if (attachmentError) {
          confirmationLines.push('');
          confirmationLines.push(`Aviso: ${buildAttachmentWarning(attachmentError)}`);
        }

        resetRequestState(session);
        session.step = STEPS.MENU;
        saveSession(from, session);

        await sendPostSuccessOptions(from, confirmationLines.join('\n'));
      } catch (error) {
        const detail = describeHttpError(error);
        session.lastCreateError = detail;
        saveSession(from, session);

        console.error('[LURANA_CASE] Error creando caso:', detail);
        await sendCreateRetryOptions(from, detail);
      }
      return;

    default:
      await resetConversationToMenu(from, session.employee);
  }
}

module.exports = {
  processMessage
};
