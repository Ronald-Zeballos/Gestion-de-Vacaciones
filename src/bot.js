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
  todayDate,
  parseDate,
  parseDateFromInput,
  parseMonthOptionId,
  parseMonthPageOptionId,
  formatMonthLabel,
  buildUpcomingMonthRows,
  parseDayPageOptionId,
  buildMonthDayRows,
  parseTime,
  parseTimeOptionId,
  parseTimePageOptionId,
  buildTimeRows,
  isWeekend,
  calculateWorkingDays,
  calculateRequestedHours,
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
  REQUEST_TYPE: 'REQUEST_TYPE',
  TIME_UNIT: 'TIME_UNIT',
  PERMISSION_TYPE: 'PERMISSION_TYPE',
  DATE_MONTH_PICK: 'DATE_MONTH_PICK',
  DATE_DAY_PICK: 'DATE_DAY_PICK',
  TIME_PICK: 'TIME_PICK',
  REASON: 'REASON',
  CERT_MED: 'CERT_MED',
  CONFIRM_REQUEST: 'CONFIRM_REQUEST'
};

const DENIED_CERT_EXTENSIONS = ['.exe', '.bat', '.sh', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar'];
const DENIED_CERT_MIMETYPES = ['application/x-msdownload', 'application/x-msdos-program', 'application/x-executable', 'application/x-elf'];

function isValidCertificateFile(mimeType, filename) {
  // Si no hay ni mimeType ni filename, rechazar
  if (!mimeType && !filename) return false;
  
  // Validar contra extensiones peligrosas
  if (filename) {
    const fileExtension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (DENIED_CERT_EXTENSIONS.includes(fileExtension)) {
      return false;
    }
  }
  
  // Validar contra tipos MIME peligrosos
  if (mimeType) {
    const mimeTypeLower = mimeType.toLowerCase();
    if (DENIED_CERT_MIMETYPES.some(denied => mimeTypeLower.includes(denied))) {
      return false;
    }
  }
  
  // Si pasó las validaciones negativas, aceptar
  return true;
}

const REQUEST_TYPE_OPTIONS = [
  { id: 'request_type_vacaciones', code: 1, title: 'Vacaciones', label: 'Vacaciones' },
  { id: 'request_type_permiso', code: 2, title: 'Permiso', label: 'Permiso' }
];

const TIME_UNIT_OPTIONS = [
  { id: 'time_unit_days', code: 1, title: 'Dias', label: 'Dias' },
  { id: 'time_unit_hours', code: 2, title: 'Horas', label: 'Horas' }
];

const PERMISSION_TYPE_OPTIONS = [
  {
    id: 'permission_fallecimiento',
    code: 1,
    title: 'Fallecimiento',
    label: 'Fallecimiento',
    description: 'Padres, conyuge, hijos, hermanos'
  },
  {
    id: 'permission_cumpleanos',
    code: 2,
    title: 'Cumpleanos',
    label: 'Cumpleanos',
    description: 'Media jornada'
  },
  {
    id: 'permission_matrimonio',
    code: 3,
    title: 'Matrimonio',
    label: 'Matrimonio',
    description: '3 dias laborables'
  },
  {
    id: 'permission_salud',
    code: 4,
    title: 'Salud',
    label: 'Salud',
    description: 'Permiso por salud'
  },
  {
    id: 'permission_maternidad',
    code: 5,
    title: 'Maternidad',
    label: 'Maternidad',
    description: 'Permiso de maternidad'
  },
  {
    id: 'permission_otros',
    code: 6,
    title: 'Otros',
    label: 'Otros',
    description: 'Otro tipo de permiso'
  }
];

function createEmptyRequest() {
  return {
    request_id: uuidv4(),
    typeRequestCode: null,
    typeRequestLabel: '',
    timeUnitCode: null,
    timeUnitLabel: '',
    typePermissionCode: null,
    typePermissionLabel: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    reason: '',
    requestedDays: 0,
    pendingDateField: '',
    pendingMonthKey: '',
    pendingMonthPage: 0,
    pendingDayPage: 0,
    pendingTimeField: '',
    pendingTimePage: 0,
    certMedMediaId: '',
    certMedMimeType: '',
    certMedFilename: ''
  };
}

function buildInitialSession(phone, lastProcessedMessageId = '') {
  return {
    phone,
    step: STEPS.MENU,
    startedAt: new Date().toISOString(),
    employee: null,
    request: createEmptyRequest(),
    lastCreateError: null,
    lastProcessedMessageId
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

function findOptionById(options, optionId) {
  return options.find((option) => option.id === optionId) || null;
}

function findOptionByCode(options, optionCode) {
  return options.find((option) => option.code === Number(optionCode)) || null;
}

function getRequestTypeOption(request) {
  return findOptionByCode(REQUEST_TYPE_OPTIONS, request?.typeRequestCode) || REQUEST_TYPE_OPTIONS[0];
}

function getTimeUnitOption(request) {
  return findOptionByCode(TIME_UNIT_OPTIONS, request?.timeUnitCode) || TIME_UNIT_OPTIONS[0];
}

function getPermissionTypeOption(request) {
  return findOptionByCode(PERMISSION_TYPE_OPTIONS, request?.typePermissionCode) || null;
}

function isVacationRequest(request) {
  return getRequestTypeOption(request).id === 'request_type_vacaciones';
}

function isHoursRequest(request) {
  return getTimeUnitOption(request).code === TIME_UNIT_OPTIONS[1].code;
}

function buildListSections(title, rows) {
  return [
    {
      title,
      rows: rows.slice(0, 10)
    }
  ];
}

function buildPermissionTypeSections() {
  return buildListSections(
    'Tipos de permiso',
    PERMISSION_TYPE_OPTIONS.map((option) => ({
      id: option.id,
      title: option.title,
      description: option.description
    }))
  );
}

function buildReasonPrompt(request) {
  if (isHoursRequest(request)) {
    return 'Escribe el motivo o comentario de la solicitud por horas';
  }

  return 'Escribe el motivo o comentario de la solicitud';
}

function buildPayloadReason(request) {
  const baseReason = normalizeText(request.reason);

  if (!isHoursRequest(request) || !request.startTime || !request.endTime) {
    return baseReason;
  }

  const schedule = `Horario solicitado: ${request.startTime} - ${request.endTime}`;
  return baseReason ? `${baseReason}. ${schedule}` : schedule;
}

function buildDateMonthPrompt(field) {
  if (field === 'end') {
    return 'Selecciona el mes de finalizacion';
  }

  if (field === 'single') {
    return 'Selecciona el mes de la fecha solicitada';
  }

  return 'Selecciona el mes de inicio';
}

function buildDateDayBlockPrompt(monthKey) {
  return `Selecciona el rango de dias de ${formatMonthLabel(monthKey)}`;
}

function buildDateDayPrompt(monthKey) {
  return `Selecciona el dia de ${formatMonthLabel(monthKey)} o escribe DD-MM-YYYY`;
}

function buildTimeBlockPrompt(field) {
  if (field === 'end') {
    return 'Selecciona el bloque horario de finalizacion';
  }

  return 'Selecciona el bloque horario de inicio';
}

function buildTimePrompt(field) {
  if (field === 'end') {
    return 'Selecciona la hora de finalizacion o escribe HH:mm';
  }

  return 'Selecciona la hora de inicio o escribe HH:mm';
}

function buildRequestedAmountLabel(request) {
  return isHoursRequest(request) ? 'Horas solicitadas' : 'Dias solicitados';
}

function formatRequestedAmount(request) {
  const amount = Number(request?.requestedDays || 0);

  if (!Number.isFinite(amount)) {
    return '0';
  }

  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace(/\.0$/, '');
  return value.replace('.', ',');
}

function getMinimumSelectableDate(request, field) {
  if (field === 'end' && request?.startDate) {
    return request.startDate;
  }

  return todayDate();
}

function clearDateSelectionState(request) {
  request.pendingDateField = '';
  request.pendingMonthKey = '';
  request.pendingMonthPage = 0;
  request.pendingDayPage = 0;
}

function clearTimeSelectionState(request) {
  request.pendingTimeField = '';
  request.pendingTimePage = 0;
}

function resetScheduleState(request) {
  request.startDate = '';
  request.endDate = '';
  request.startTime = '';
  request.endTime = '';
  request.requestedDays = 0;
  clearDateSelectionState(request);
  clearTimeSelectionState(request);
}

function parseSelectedDate(input, plainText) {
  return parseDateFromInput(input, plainText);
}

function parseSelectedTime(input, plainText) {
  const timeFromId = parseTimeOptionId(input);

  if (timeFromId) {
    return timeFromId.format('HH:mm');
  }

  const timeFromText = parseTime(plainText);
  return timeFromText ? timeFromText.format('HH:mm') : '';
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
  const requestType = getRequestTypeOption(request);
  const timeUnit = getTimeUnitOption(request);
  const permissionType = getPermissionTypeOption(request);
  const certificateStatus = request.certMedMediaId
    ? `Adjuntado${request.certMedFilename ? `: ${request.certMedFilename}` : ''}`
    : 'No adjuntado';
  const lines = [
    'Resumen de solicitud',
    '',
    `Empleado: ${(employee.firstName || employee.userName || '').trim()} ${(employee.lastName || '').trim()}`.trim(),
    `Correo: ${employee.email || ''}`,
    `Tipo de solicitud: ${request.typeRequestLabel || requestType.label}`,
    `Unidad de tiempo: ${request.timeUnitLabel || timeUnit.label}`,
    `Tipo de permiso: ${isVacationRequest(request) ? 'No aplica' : (request.typePermissionLabel || permissionType?.label || 'Pendiente')}`
  ];

  if (isHoursRequest(request)) {
    lines.push(`Fecha: ${request.startDate || 'Pendiente'}`);
    lines.push(`Horario: ${request.startTime && request.endTime ? `${request.startTime} - ${request.endTime}` : 'Pendiente'}`);
  } else {
    lines.push(`Fecha inicio: ${request.startDate || 'Pendiente'}`);
    lines.push(`Fecha fin: ${request.endDate || 'Pendiente'}`);
  }

  lines.push(`${buildRequestedAmountLabel(request)}: ${formatRequestedAmount(request)}`);
  lines.push(`Motivo: ${request.reason || 'Pendiente'}`);
  lines.push(`Certificado medico: ${certificateStatus}`);
  return lines.join('\n');
}

function buildCreateCasePayload(employee, request) {
  const requestType = getRequestTypeOption(request);
  const timeUnit = getTimeUnitOption(request);
  const permissionType = getPermissionTypeOption(request);
  const hasCertificate = Boolean(request.certMedMediaId);

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
        typeRequest: requestType.code,
        typeRequestLabel: request.typeRequestLabel || requestType.label,
        daysHours: timeUnit.code,
        daysHoursLabel: request.timeUnitLabel || timeUnit.label,
        typePermission: isVacationRequest(request) ? '' : String(permissionType?.code || PERMISSION_TYPE_OPTIONS[0].code),
        typePermissionLabel: isVacationRequest(request) ? '' : (request.typePermissionLabel || permissionType?.label || ''),
        reason: buildPayloadReason(request),
        startDate: request.startDate,
        endDate: request.endDate || request.startDate,
        certMedAttached: hasCertificate ? '1' : '0',
        certMedFilename: request.certMedFilename || '',
        certMedMimeType: request.certMedMimeType || '',
        certMedMediaId: request.certMedMediaId || ''
      }
    ]
  };
}

function buildCertificatePrompt() {
  return [
    'Adjunta tu certificado medico como documento o imagen de WhatsApp.',
    'Si no aplica, pulsa Omitir o escribe "omitir".'
  ].join('\n');
}

function buildCertificateComment(session) {
  const requestId = session.request?.request_id || 'sin-request-id';
  const username = session.employee?.userName || 'sin-username';
  const filename = session.request?.certMedFilename || 'sin-filename';
  const mimeType = session.request?.certMedMimeType || 'sin-mime';
  const mediaId = session.request?.certMedMediaId || 'sin-media-id';

  return [
    'Certificado medico recibido por WhatsApp.',
    `request_id=${requestId}`,
    `user=${username}`,
    `filename=${filename}`,
    `mime=${mimeType}`,
    `media_id=${mediaId}`
  ].join(' ');
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

async function sendRequestTypePrompt(to, session, body = 'Selecciona el tipo de solicitud') {
  session.step = STEPS.REQUEST_TYPE;
  session.lastCreateError = null;
  saveSession(to, session);

  await sendButtonsMessage(
    to,
    body,
    [
      { id: REQUEST_TYPE_OPTIONS[0].id, title: REQUEST_TYPE_OPTIONS[0].title },
      { id: REQUEST_TYPE_OPTIONS[1].id, title: REQUEST_TYPE_OPTIONS[1].title },
      { id: 'cancel_flow', title: 'Cancelar' }
    ]
  );
}

async function sendTimeUnitPrompt(to, session, body = 'Selecciona la unidad de tiempo') {
  session.step = STEPS.TIME_UNIT;
  session.lastCreateError = null;
  saveSession(to, session);

  await sendButtonsMessage(
    to,
    body,
    [
      { id: TIME_UNIT_OPTIONS[0].id, title: TIME_UNIT_OPTIONS[0].title },
      { id: TIME_UNIT_OPTIONS[1].id, title: TIME_UNIT_OPTIONS[1].title },
      { id: 'cancel_flow', title: 'Cancelar' }
    ]
  );
}

async function sendPermissionTypePrompt(to, session, body = 'Selecciona el tipo de permiso') {
  session.step = STEPS.PERMISSION_TYPE;
  session.lastCreateError = null;
  saveSession(to, session);

  await sendListMessage(
    to,
    body,
    'Elegir tipo',
    buildPermissionTypeSections()
  );
}

async function sendDateMonthPrompt(
  to,
  session,
  field,
  body = buildDateMonthPrompt(field),
  page = 0
) {
  const minDate = getMinimumSelectableDate(session.request, field);
  const rows = buildUpcomingMonthRows(12, minDate, page, 6);

  session.request.pendingDateField = field;
  session.request.pendingMonthPage = page;
  session.request.pendingMonthKey = '';
  session.request.pendingDayPage = 0;
  session.step = STEPS.DATE_MONTH_PICK;
  session.lastCreateError = null;
  saveSession(to, session);

  await sendListMessage(
    to,
    body,
    'Elegir mes',
    buildListSections('Meses', rows)
  );
}

async function sendDateDayPrompt(
  to,
  session,
  page = 0,
  body = buildDateDayPrompt(session.request.pendingMonthKey)
) {
  const minDate = getMinimumSelectableDate(session.request, session.request.pendingDateField);
  const rows = buildMonthDayRows(session.request.pendingMonthKey, minDate, page, 8);

  if (!rows.length) {
    await sendDateMonthPrompt(
      to,
      session,
      session.request.pendingDateField || (isHoursRequest(session.request) ? 'single' : 'start'),
      `No hay dias habilitados disponibles en ${formatMonthLabel(session.request.pendingMonthKey)}`
    );
    return;
  }

  session.request.pendingDayPage = Number(page) >= 0 ? Number(page) : 0;
  session.step = STEPS.DATE_DAY_PICK;
  session.lastCreateError = null;
  saveSession(to, session);

  await sendListMessage(
    to,
    body,
    'Elegir dia',
    buildListSections('Dias', rows)
  );
}

async function sendTimePrompt(
  to,
  session,
  page = 0,
  body = buildTimePrompt(session.request.pendingTimeField)
) {
  const minTime = session.request.pendingTimeField === 'end' ? session.request.startTime : null;
  const rows = buildTimeRows(minTime, page, 8);

  if (!rows.length) {
    if ((session.request.pendingTimeField || 'start') === 'end') {
      session.request.pendingTimeField = 'start';
      session.request.pendingTimePage = 0;
      await sendTimePrompt(to, session, 0, 'La hora de inicio ya no deja un rango valido. Elige otra hora de inicio.');
      return;
    }

    await sendTextMessage(to, 'No hay horarios disponibles en este momento. Intenta nuevamente.');
    return;
  }

  session.request.pendingTimePage = Number(page) >= 0 ? Number(page) : 0;
  session.step = STEPS.TIME_PICK;
  session.lastCreateError = null;
  saveSession(to, session);

  await sendListMessage(
    to,
    body,
    'Elegir hora',
    buildListSections('Horas', rows)
  );
}

async function moveToConfirmRequest(phone, session) {
  clearDateSelectionState(session.request);
  clearTimeSelectionState(session.request);
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

    case STEPS.REQUEST_TYPE:
      await sendRequestTypePrompt(phone, session);
      return;

    case STEPS.TIME_UNIT:
      await sendTimeUnitPrompt(phone, session);
      return;

    case STEPS.PERMISSION_TYPE:
      await sendPermissionTypePrompt(phone, session);
      return;

    case STEPS.DATE_MONTH_PICK:
      await sendDateMonthPrompt(
        phone,
        session,
        session.request.pendingDateField || (isHoursRequest(session.request) ? 'single' : 'start'),
        buildDateMonthPrompt(session.request.pendingDateField || (isHoursRequest(session.request) ? 'single' : 'start')),
        session.request.pendingMonthPage || 0
      );
      return;

    case STEPS.DATE_DAY_PICK:
      if (!session.request.pendingMonthKey) {
        await sendDateMonthPrompt(
          phone,
          session,
          session.request.pendingDateField || (isHoursRequest(session.request) ? 'single' : 'start')
        );
        return;
      }

      await sendDateDayPrompt(
        phone,
        session,
        session.request.pendingDayPage || 0
      );
      return;

    case STEPS.TIME_PICK:
      await sendTimePrompt(
        phone,
        session,
        session.request.pendingTimePage || 0
      );
      return;

    case STEPS.REASON:
      await sendTextMessage(phone, buildReasonPrompt(session.request));
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
    await sendTextMessage(phone, 'Recibi el archivo, pero no encontre el mediaId. Intenta reenviarlo');
    return;
  }

  const mimeType = message.mimeType || message.mime_type || '';
  const filename = message.filename || `certificado-${session.request.request_id}`;

  if (!isValidCertificateFile(mimeType, filename)) {
    await sendTextMessage(
      phone,
      'El archivo no es permitido. Intenta con otro documento, imagen o archivo compatible.\n\nNo se permiten archivos ejecutables.'
    );
    return;
  }

  session.request.certMedMediaId = message.mediaId;
  session.request.certMedMimeType = mimeType;
  session.request.certMedFilename = filename;
  saveSession(phone, session);

  console.log('[CERT_MED] Archivo recibido desde WhatsApp:', {
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

  try {
    console.log('[CERT_MED] Descargando certificado medico:', {
      appUid,
      mediaId,
      filename: session.request.certMedFilename || null,
      mimeType: session.request.certMedMimeType || null
    });

    const downloadedMedia = await downloadWhatsAppMediaById(
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

async function resetConversationToMenu(phone, employee = null, introText = '', lastProcessedMessageId = '') {
  if (employee?.userName) {
    await persistEmployeeProfile(phone, employee);
  }

  clearSession(phone);

  const session = buildInitialSession(phone, lastProcessedMessageId);
  if (employee) {
    session.employee = employee;
  }

  saveSession(phone, session);
  await sendMainMenu(phone, session, introText);
}

async function exitConversation(phone, session) {
  if (session?.employee?.userName) {
    await persistEmployeeProfile(phone, session.employee);
  }

  clearSession(phone);
  await sendTextMessage(phone, 'Hasta luego. Guarde tu perfil para la proxima.');
}

async function restoreSessionFromProfile(phone, lastProcessedMessageId = '') {
  const profile = getProfile(phone);

  if (!profile?.username) {
    return null;
  }

  const apiResponse = await getUserData(profile.username);
  const employee = hydrateEmployee(parseApiUser(apiResponse), profile.username);

  if (!employee) {
    throw new Error('No se pudo reconstruir el perfil guardado');
  }

  const session = buildInitialSession(phone, lastProcessedMessageId);
  session.employee = employee;
  saveSession(phone, session);
  await persistEmployeeProfile(phone, employee);

  return {
    profile,
    session
  };
}

async function completeDateSelection(phone, session, selectedDate) {
  const dateValue = parseDate(selectedDate);
  const field = session.request.pendingDateField || (isHoursRequest(session.request) ? 'single' : 'start');
  const minimumDate = parseDate(getMinimumSelectableDate(session.request, field));

  if (!dateValue) {
    await sendDateMonthPrompt(phone, session, field);
    return;
  }

  if (minimumDate && dateValue.isBefore(minimumDate, 'day')) {
    const body = field === 'end'
      ? 'La fecha fin no puede ser menor a la fecha inicio'
      : 'Selecciona una fecha habilitada desde hoy';
    await sendDateMonthPrompt(phone, session, field, body, session.request.pendingMonthPage || 0);
    return;
  }

  if (isWeekend(dateValue)) {
    await sendDateMonthPrompt(
      phone,
      session,
      field,
      'No se permiten fechas en fin de semana. Elige otra fecha habil.',
      session.request.pendingMonthPage || 0
    );
    return;
  }

  const formattedDate = dateValue.format(DATE_FORMAT);
  clearDateSelectionState(session.request);

  if (field === 'end') {
    const start = parseDate(session.request.startDate);

    if (!start || dateValue.isBefore(start, 'day')) {
      await sendDateMonthPrompt(phone, session, 'end', 'La fecha fin no puede ser menor a la fecha inicio');
      return;
    }

    session.request.endDate = formattedDate;
    session.request.requestedDays = calculateWorkingDays(
      session.request.startDate,
      session.request.endDate
    );
    session.step = STEPS.REASON;
    session.lastCreateError = null;
    saveSession(phone, session);

    await sendTextMessage(phone, buildReasonPrompt(session.request));
    return;
  }

  session.request.startDate = formattedDate;
  session.request.endDate = formattedDate;
  session.request.requestedDays = 0;

  if (isHoursRequest(session.request)) {
    session.request.startTime = '';
    session.request.endTime = '';
    session.request.pendingTimeField = 'start';
    await sendTimePrompt(phone, session, 0);
    return;
  }

  session.request.endDate = '';
  await sendDateMonthPrompt(phone, session, 'end');
}

async function completeTimeSelection(phone, session, selectedTime) {
  const timeValue = parseTime(selectedTime);
  const field = session.request.pendingTimeField || 'start';

  if (!timeValue) {
    await sendTimePrompt(phone, session, session.request.pendingTimePage || 0);
    return;
  }

  const formattedTime = timeValue.format('HH:mm');
  clearTimeSelectionState(session.request);

  if (field === 'start') {
    if (!buildTimeRows(formattedTime, 0, 8).length) {
      session.request.pendingTimeField = 'start';
      await sendTimePrompt(phone, session, 0, 'Selecciona una hora de inicio que permita elegir una hora fin');
      return;
    }

    session.request.startTime = formattedTime;
    session.request.endTime = '';
    session.request.requestedDays = 0;
    session.request.pendingTimeField = 'end';
    await sendTimePrompt(phone, session, 0);
    return;
  }

  const startTime = parseTime(session.request.startTime);

  if (!startTime || !timeValue.isAfter(startTime)) {
    session.request.pendingTimeField = 'end';
    await sendTimePrompt(phone, session, 0, 'La hora fin debe ser mayor a la hora inicio');
    return;
  }

  session.request.endTime = formattedTime;
  session.request.requestedDays = calculateRequestedHours(
    session.request.startTime,
    session.request.endTime
  );
  session.step = STEPS.REASON;
  session.lastCreateError = null;
  saveSession(phone, session);

  await sendTextMessage(phone, buildReasonPrompt(session.request));
}

async function processMessage(message) {
  const from = normalizeText(message.from);
  const input = getUserInput(message);
  const plainText = normalizeText(message.text);
  const inputLower = input.toLowerCase();
  const messageId = normalizeText(message.messageId);

  if (!from) return;

  let session = getSession(from);

  if (session && messageId) {
    if (session.lastProcessedMessageId === messageId) {
      console.log('[DEDUPE] Mensaje duplicado ignorado:', { phone: from, messageId });
      return;
    }

    session.lastProcessedMessageId = messageId;
    saveSession(from, session);
  }

  try {
    if (inputLower === 'menu') {
      await resetConversationToMenu(from, session?.employee, 'Volvimos al menu principal.', messageId);
      return;
    }

    if (session?.lastCreateError && (
      input === 'menu_start' ||
      input === 'cancel_flow' ||
      inputLower === 'cancelar'
    )) {
      await resetConversationToMenu(from, session.employee, 'Volvimos al menu principal.', messageId);
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
        const restored = await restoreSessionFromProfile(from, messageId);

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

      session = buildInitialSession(from, messageId);
      saveSession(from, session);
      await sendMainMenu(from, session);
      return;
    }

    if ((message.type === 'document' || message.type === 'image') && session.step !== STEPS.MENU) {
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
          await sendRequestTypePrompt(from, session);
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
        await sendRequestTypePrompt(from, session);
        return;

      case STEPS.REQUEST_TYPE: {
        const selectedRequestType = findOptionById(REQUEST_TYPE_OPTIONS, input);

        if (!selectedRequestType) {
          await sendRequestTypePrompt(from, session, 'Selecciona el tipo de solicitud');
          return;
        }

        session.request.typeRequestCode = selectedRequestType.code;
        session.request.typeRequestLabel = selectedRequestType.label;
        session.request.typePermissionCode = null;
        session.request.typePermissionLabel = '';
        resetScheduleState(session.request);
        await sendTimeUnitPrompt(from, session);
        return;
      }

      case STEPS.TIME_UNIT: {
        const selectedTimeUnit = findOptionById(TIME_UNIT_OPTIONS, input);

        if (!selectedTimeUnit) {
          await sendTimeUnitPrompt(from, session, 'Selecciona la unidad de tiempo');
          return;
        }

        session.request.timeUnitCode = selectedTimeUnit.code;
        session.request.timeUnitLabel = selectedTimeUnit.label;
        resetScheduleState(session.request);

        if (isVacationRequest(session.request)) {
          session.request.typePermissionCode = 0;
          session.request.typePermissionLabel = 'No aplica';
          await sendDateMonthPrompt(
            from,
            session,
            isHoursRequest(session.request) ? 'single' : 'start'
          );
          return;
        }

        session.request.typePermissionCode = null;
        session.request.typePermissionLabel = '';
        await sendPermissionTypePrompt(from, session);
        return;
      }

      case STEPS.PERMISSION_TYPE: {
        const selectedPermissionType = findOptionById(PERMISSION_TYPE_OPTIONS, input);

        if (!selectedPermissionType) {
          await sendPermissionTypePrompt(from, session, 'Selecciona el tipo de permiso');
          return;
        }

        session.request.typePermissionCode = selectedPermissionType.code;
        session.request.typePermissionLabel = selectedPermissionType.label;
        await sendDateMonthPrompt(
          from,
          session,
          isHoursRequest(session.request) ? 'single' : 'start'
        );
        return;
      }

      case STEPS.DATE_MONTH_PICK: {
        const field = session.request.pendingDateField || (isHoursRequest(session.request) ? 'single' : 'start');
        const requestedPage = parseMonthPageOptionId(input);

        if (requestedPage !== null) {
          await sendDateMonthPrompt(from, session, field, buildDateMonthPrompt(field), requestedPage);
          return;
        }

        const selectedMonth = parseMonthOptionId(input);

        if (selectedMonth) {
          const monthKey = selectedMonth.format('YYYY-MM');
          session.request.pendingMonthKey = monthKey;
          session.request.pendingDayPage = 0;
          await sendDateDayPrompt(from, session, 0);
          return;
        }

        const selectedDate = parseSelectedDate(input, plainText);

        if (selectedDate) {
          await completeDateSelection(from, session, selectedDate);
          return;
        }

        await sendDateMonthPrompt(from, session, field);
        return;
      }

      case STEPS.DATE_DAY_PICK: {
        const requestedPage = parseDayPageOptionId(input);

        if (requestedPage !== null) {
          await sendDateDayPrompt(from, session, requestedPage);
          return;
        }

        const selectedDate = parseSelectedDate(input, plainText);

        if (!selectedDate) {
          await sendDateDayPrompt(
            from,
            session,
            session.request.pendingDayPage || 0
          );
          return;
        }

        await completeDateSelection(from, session, selectedDate);
        return;
      }

      case STEPS.TIME_PICK: {
        const requestedPage = parseTimePageOptionId(input);

        if (requestedPage !== null) {
          await sendTimePrompt(from, session, requestedPage);
          return;
        }

        const selectedTime = parseSelectedTime(input, plainText);

        if (!selectedTime) {
          await sendTimePrompt(
            from,
            session,
            session.request.pendingTimePage || 0
          );
          return;
        }

        await completeTimeSelection(from, session, selectedTime);
        return;
      }

      case STEPS.REASON:
        if (!plainText) {
          await sendTextMessage(from, 'Debes escribir un motivo o comentario');
          return;
        }

        session.request.reason = plainText;
        session.lastCreateError = null;
        saveSession(from, session);

        const isSalutPermission = session.request.typePermissionCode === 4;
        const isVacation = isVacationRequest(session.request);
        const requiresCertificate = isSalutPermission && !isVacation;

        if (requiresCertificate) {
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
        } else {
          session.request.certMedMediaId = '';
          session.request.certMedMimeType = '';
          session.request.certMedFilename = '';
          await moveToConfirmRequest(from, session);
        }
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
          'Adjunta el certificado como documento o imagen de WhatsApp, o escribe "omitir" para continuar sin archivo'
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
            `${buildRequestedAmountLabel(requestSnapshot)}: ${formatRequestedAmount(requestSnapshot)}`
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
        await resetConversationToMenu(from, session.employee, '', messageId);
    }
  } catch (error) {
    console.error('[BOT] Error general del flujo:', describeHttpError(error));
    clearSession(from);

    try {
      await sendTextMessage(
        from,
        "Tuve un problema enviando el siguiente paso. Escribe 'menu' para volver a empezar."
      );
    } catch (fallbackError) {
      console.error('[BOT] Error enviando fallback:', describeHttpError(fallbackError));
    }
  }
}

module.exports = {
  processMessage
};
