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
  calculateWorkingDays
} = require('./utils');
const {
  getUserData,
  createPtoCase
} = require('./luranaApi');

const STEPS = {
  MENU: 'MENU',
  USERNAME: 'USERNAME',
  CONFIRM_PROFILE: 'CONFIRM_PROFILE',
  START_DATE: 'START_DATE',
  END_DATE: 'END_DATE',
  REASON: 'REASON',
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
      requestedDays: 0
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
    `👤 ${(employee.firstName || employee.userName || '').trim()} ${(employee.lastName || '').trim()}`.trim(),
    `📧 ${employee.email || ''}`,
    `🆔 ${employee.userName || ''}`
  ].filter(Boolean).join('\n');
}

function buildRequestSummary(session) {
  const e = session.employee;
  const r = session.request;

  return [
    '📋 Resumen de solicitud',
    '',
    `Empleado: ${(e.firstName || e.userName || '').trim()} ${(e.lastName || '').trim()}`.trim(),
    `Correo: ${e.email || ''}`,
    `Fecha inicio: ${r.startDate}`,
    `Fecha fin: ${r.endDate}`,
    `Días solicitados: ${r.requestedDays}`,
    `Motivo: ${r.reason}`
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

async function sendMainMenu(to) {
  await sendButtonsMessage(
    to,
    `Hola 👋\nSoy el asistente de *${config.companyName}*.\n\n¿Qué deseas hacer?`,
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

  switch (session.step) {
    case STEPS.MENU:
      if (input !== 'menu_start' && inputLower !== 'nueva solicitud' && inputLower !== 'iniciar') {
        await sendMainMenu(from);
        return;
      }

      session.step = STEPS.USERNAME;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *username* corporativo');
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
          await sendTextMessage(from, 'No encontré un usuario con ese username. Intenta nuevamente');
          return;
        }

        session.employee = employee;
        session.step = STEPS.CONFIRM_PROFILE;
        saveSession(from, session);

        await sendButtonsMessage(
          from,
          `Encontré estos datos:\n\n${employeeSummary(employee)}\n\n¿Son correctos?`,
          [
            { id: 'profile_ok', title: 'Sí' },
            { id: 'profile_retry', title: 'No' }
          ]
        );
      } catch (error) {
        console.error('Error consultando getUserData:', error.response?.data || error.message);
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
        await sendTextMessage(from, 'Selecciona una opción válida');
        return;
      }

      session.step = STEPS.START_DATE;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe la *fecha de inicio* en formato DD-MM-YYYY');
      return;

    case STEPS.START_DATE: {
      const start = parseDate(plainText);

      if (!start) {
        await sendTextMessage(from, 'Fecha inválida. Usa DD-MM-YYYY');
        return;
      }

      if (isWeekend(start)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana');
        return;
      }

      session.request.startDate = start.format('DD-MM-YYYY');
      session.step = STEPS.END_DATE;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe la *fecha de fin* en formato DD-MM-YYYY');
      return;
    }

    case STEPS.END_DATE: {
      const end = parseDate(plainText);
      const start = parseDate(session.request.startDate);

      if (!end || !start) {
        await sendTextMessage(from, 'Fecha inválida. Usa DD-MM-YYYY');
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

      await sendTextMessage(from, 'Escribe el *motivo* de tus vacaciones');
      return;
    }

    case STEPS.REASON:
      if (!plainText) {
        await sendTextMessage(from, 'Debes escribir un motivo');
        return;
      }

      session.request.reason = plainText;
      session.step = STEPS.CONFIRM_REQUEST;
      saveSession(from, session);

      await sendButtonsMessage(
        from,
        `${buildRequestSummary(session)}\n\n¿Deseas registrar la solicitud?`,
        [
          { id: 'request_confirm', title: 'Confirmar' },
          { id: 'cancel_flow', title: 'Cancelar' }
        ]
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

        saveRequest(session.request.request_id, {
          local_request_id: session.request.request_id,
          phone: from,
          employee: session.employee,
          request: session.request,
          lurana_payload: payload,
          lurana_response: apiResponse
        });

        clearSession(from);

        await sendTextMessage(
          from,
          `Solicitud registrada correctamente ✅\n\nDías solicitados: ${session.request.requestedDays}`
        );
      } catch (error) {
        console.error('Error creando caso:', error.response?.data || error.message);
        await sendTextMessage(
          from,
          'Ocurrió un error al crear el caso. Falta validar token, pro_uid o formato final del payload'
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
