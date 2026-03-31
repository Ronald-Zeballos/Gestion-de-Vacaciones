const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const {
  getSession,
  saveSession,
  clearSession,
  saveEmployee,
  getEmployeeByPhone,
  saveRequest
} = require('./storage');
const {
  sendTextMessage,
  sendButtonsMessage,
  sendListMessage
} = require('./whatsapp');
const { sendRequestEmail } = require('./mailer');
const {
  normalizeText,
  todayDate,
  parseDate,
  parseDateTime,
  isWeekend,
  calculateWorkingDays,
  calculateHours,
  isValidEmail,
  mapTypeRequest,
  mapUnit,
  mapPermission
} = require('./utils');

const STEPS = {
  MENU: 'MENU',
  USE_SAVED_PROFILE: 'USE_SAVED_PROFILE',
  FULL_NAME: 'FULL_NAME',
  EMAIL: 'EMAIL',
  USERNAME: 'USERNAME',
  AREA: 'AREA',
  POSITION: 'POSITION',
  DIRECTOR: 'DIRECTOR',
  CONTRACT_TYPE: 'CONTRACT_TYPE',
  BALANCE: 'BALANCE',
  TYPE_REQUEST: 'TYPE_REQUEST',
  UNIT_TIME: 'UNIT_TIME',
  TYPE_PERMISSION: 'TYPE_PERMISSION',
  CUSTOM_REASON: 'CUSTOM_REASON',
  START_DATE: 'START_DATE',
  END_DATE: 'END_DATE',
  START_HOUR: 'START_HOUR',
  END_HOUR: 'END_HOUR',
  COMMENTS: 'COMMENTS',
  MEDICAL_CERTIFICATE: 'MEDICAL_CERTIFICATE',
  CONFIRM: 'CONFIRM'
};

function buildInitialSession(phone, savedEmployee = null) {
  return {
    phone,
    step: STEPS.MENU,
    startedAt: new Date().toISOString(),
    employee: savedEmployee || {
      phone,
      var_firstname: '',
      var_lastname: '',
      var_mail: '',
      var_area: '',
      var_position: '',
      var_area_director: '',
      var_contract_type: '',
      var_user_name: ''
    },
    request: {
      var_requested_date: todayDate(),
      var_type_request: '',
      var_days_hours: '',
      var_type_permission: '',
      var_reason: '',
      var_balance: '',
      var_start_date: '',
      var_end_date: '',
      var_days_requested: '',
      var_start_hour: '',
      var_end_hour: '',
      var_hour_requested: '',
      var_requester_comment: '',
      var_medical_certificate: false
    }
  };
}

function splitFullName(fullName) {
  const parts = normalizeText(fullName).split(/\s+/).filter(Boolean);

  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };

  return {
    firstName: parts.slice(0, Math.ceil(parts.length / 2)).join(' '),
    lastName: parts.slice(Math.ceil(parts.length / 2)).join(' ')
  };
}

function getUserInput(message) {
  const interactiveId = normalizeText(message.interactiveId);
  const text = normalizeText(message.text);
  return interactiveId || text;
}

function getUserText(message) {
  return normalizeText(message.text);
}

function employeeSummary(employee) {
  return [
    `👤 ${[employee.var_firstname, employee.var_lastname].filter(Boolean).join(' ')}`,
    `📧 ${employee.var_mail}`,
    `🆔 ${employee.var_user_name}`,
    `🏢 ${employee.var_area}`,
    `💼 ${employee.var_position}`
  ].join('\n');
}

async function sendMainMenu(to) {
  await sendButtonsMessage(
    to,
    `Hola 👋\nSoy el asistente de *${config.companyName}*.\n\n¿Qué deseas hacer?`,
    [
      { id: 'menu_start', title: 'Nueva solicitud' },
      { id: 'menu_info', title: 'Requisitos' },
      { id: 'menu_cancel', title: 'Cancelar' }
    ]
  );
}

async function sendTypeRequestList(to) {
  await sendListMessage(
    to,
    'Selecciona el tipo de solicitud',
    'Ver opciones',
    [
      {
        title: 'Tipos de solicitud',
        rows: [
          { id: 'type_request_1', title: 'Vacaciones', description: 'Solicitud de vacaciones' },
          { id: 'type_request_2', title: 'Permiso', description: 'Solicitud de permiso' }
        ]
      }
    ]
  );
}

async function sendUnitButtons(to) {
  await sendButtonsMessage(to, 'Selecciona la unidad de tiempo', [
    { id: 'unit_1', title: 'Días' },
    { id: 'unit_2', title: 'Horas' }
  ]);
}

async function sendPermissionList(to) {
  await sendListMessage(
    to,
    'Selecciona el tipo de permiso',
    'Ver permisos',
    [
      {
        title: 'Permisos',
        rows: [
          { id: 'permission_1', title: 'Fallecimiento', description: 'Familia directa' },
          { id: 'permission_2', title: 'Cumpleaños', description: 'Media jornada' },
          { id: 'permission_3', title: 'Matrimonio', description: '3 días laborales' },
          { id: 'permission_4', title: 'Salud', description: 'Requiere certificado médico' },
          { id: 'permission_5', title: 'Maternidad', description: 'Requiere certificado médico' },
          { id: 'permission_6', title: 'Otros', description: 'Motivo personalizado' }
        ]
      }
    ]
  );
}

function buildSummary(session) {
  const e = session.employee;
  const r = session.request;

  return [
    '📋 *Resumen de la solicitud*',
    '',
    `👤 Nombre: ${[e.var_firstname, e.var_lastname].filter(Boolean).join(' ')}`,
    `📧 Correo: ${e.var_mail}`,
    `🆔 Usuario: ${e.var_user_name}`,
    `🏢 Área: ${e.var_area}`,
    `💼 Cargo: ${e.var_position}`,
    `👔 Director: ${e.var_area_director}`,
    `📄 Contrato: ${e.var_contract_type}`,
    `📌 Tipo: ${mapTypeRequest(r.var_type_request)}`,
    `⏱ Unidad: ${mapUnit(r.var_days_hours)}`,
    r.var_type_request === '2' ? `📂 Permiso: ${mapPermission(r.var_type_permission)}` : null,
    r.var_reason ? `📝 Motivo: ${r.var_reason}` : null,
    r.var_days_hours === '1' ? `📅 Inicio: ${r.var_start_date}` : `🕐 Inicio: ${r.var_start_hour}`,
    r.var_days_hours === '1' ? `📅 Fin: ${r.var_end_date}` : `🕐 Fin: ${r.var_end_hour}`,
    r.var_days_hours === '1' ? `📆 Días solicitados: ${r.var_days_requested}` : `🕒 Horas solicitadas: ${r.var_hour_requested}`,
    `💬 Comentarios: ${r.var_requester_comment || 'Sin comentarios'}`,
    `🏥 Certificado médico: ${r.var_medical_certificate ? 'Sí' : 'No'}`
  ].filter(Boolean).join('\n');
}

async function processMessage(message) {
  const from = normalizeText(message.from);
  const input = getUserInput(message);
  const plainText = getUserText(message);
  const inputLower = input.toLowerCase();

  if (!from) return;

  if (inputLower === 'cancelar' || inputLower === 'menu_cancel') {
    clearSession(from);
    await sendTextMessage(from, 'Solicitud cancelada correctamente');
    return;
  }

  let session = getSession(from);

  if (!session) {
    const savedEmployee = getEmployeeByPhone(from);
    session = buildInitialSession(from, savedEmployee);
    saveSession(from, session);
    await sendMainMenu(from);
    return;
  }

  switch (session.step) {
    case STEPS.MENU:
      if (input === 'menu_info') {
        await sendTextMessage(
          from,
          '📌 Requisitos mínimos:\n- Tipo de solicitud\n- Fechas u horas\n- Comentario\n- Certificado médico si corresponde\n\nTus datos personales pueden reutilizarse automáticamente'
        );
        await sendMainMenu(from);
        return;
      }

      if (input === 'menu_start' || inputLower === 'iniciar') {
        const savedEmployee = getEmployeeByPhone(from);

        if (savedEmployee) {
          session.employee = savedEmployee;
          session.step = STEPS.USE_SAVED_PROFILE;
          saveSession(from, session);

          await sendButtonsMessage(
            from,
            `Encontré tus datos guardados:\n\n${employeeSummary(savedEmployee)}\n\n¿Deseas usarlos?`,
            [
              { id: 'profile_yes', title: 'Usarlos' },
              { id: 'profile_no', title: 'Actualizar' },
              { id: 'menu_cancel', title: 'Cancelar' }
            ]
          );
          return;
        }

        session.step = STEPS.FULL_NAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Escribe tu *nombre completo*');
        return;
      }

      await sendMainMenu(from);
      return;

    case STEPS.USE_SAVED_PROFILE:
      if (input === 'profile_yes') {
        session.step = STEPS.BALANCE;
        saveSession(from, session);
        await sendTextMessage(from, 'Escribe tu *saldo disponible* de vacaciones en número');
        return;
      }

      if (input === 'profile_no') {
        session.employee = {
          phone: from,
          var_firstname: '',
          var_lastname: '',
          var_mail: '',
          var_area: '',
          var_position: '',
          var_area_director: '',
          var_contract_type: '',
          var_user_name: ''
        };
        session.step = STEPS.FULL_NAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Perfecto. Escribe tu *nombre completo*');
        return;
      }

      await sendTextMessage(from, 'Selecciona una opción válida');
      return;

    case STEPS.FULL_NAME: {
      if (!plainText || plainText.length < 4) {
        await sendTextMessage(from, 'Por favor escribe tu nombre completo correctamente');
        return;
      }
      const { firstName, lastName } = splitFullName(plainText);
      session.employee.var_firstname = firstName;
      session.employee.var_lastname = lastName;
      session.employee.phone = from;
      session.step = STEPS.EMAIL;
      saveSession(from, session);
      await sendTextMessage(from, 'Ahora escribe tu *correo corporativo*');
      return;
    }

    case STEPS.EMAIL:
      if (!isValidEmail(plainText)) {
        await sendTextMessage(from, 'Correo inválido. Ejemplo: nombre@empresa.com');
        return;
      }
      session.employee.var_mail = plainText;
      session.step = STEPS.USERNAME;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *usuario interno*');
      return;

    case STEPS.USERNAME:
      session.employee.var_user_name = plainText;
      session.step = STEPS.AREA;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *área de trabajo*');
      return;

    case STEPS.AREA:
      session.employee.var_area = plainText;
      session.step = STEPS.POSITION;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *cargo*');
      return;

    case STEPS.POSITION:
      session.employee.var_position = plainText;
      session.step = STEPS.DIRECTOR;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *director de área*');
      return;

    case STEPS.DIRECTOR:
      session.employee.var_area_director = plainText;
      session.step = STEPS.CONTRACT_TYPE;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *tipo de contrato*');
      return;

    case STEPS.CONTRACT_TYPE:
      session.employee.var_contract_type = plainText;
      session.step = STEPS.BALANCE;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe tu *saldo disponible* de vacaciones en número');
      return;

    case STEPS.BALANCE:
      if (Number.isNaN(Number(plainText)) || Number(plainText) < 0) {
        await sendTextMessage(from, 'Saldo inválido. Escribe solo un número');
        return;
      }
      session.request.var_balance = String(plainText);
      session.step = STEPS.TYPE_REQUEST;
      saveSession(from, session);
      await sendTypeRequestList(from);
      return;

    case STEPS.TYPE_REQUEST:
      if (!['type_request_1', 'type_request_2'].includes(input)) {
        await sendTypeRequestList(from);
        return;
      }
      session.request.var_type_request = input === 'type_request_1' ? '1' : '2';
      session.step = STEPS.UNIT_TIME;
      saveSession(from, session);
      await sendUnitButtons(from);
      return;

    case STEPS.UNIT_TIME:
      if (!['unit_1', 'unit_2'].includes(input)) {
        await sendUnitButtons(from);
        return;
      }
      session.request.var_days_hours = input === 'unit_1' ? '1' : '2';

      if (session.request.var_type_request === '2') {
        session.step = STEPS.TYPE_PERMISSION;
        saveSession(from, session);
        await sendPermissionList(from);
        return;
      }

      session.step = session.request.var_days_hours === '1' ? STEPS.START_DATE : STEPS.START_HOUR;
      saveSession(from, session);

      await sendTextMessage(
        from,
        session.request.var_days_hours === '1'
          ? 'Escribe la *fecha de inicio* en formato DD-MM-YYYY'
          : 'Escribe la *hora de inicio* en formato DD-MM-YYYY HH:mm'
      );
      return;

    case STEPS.TYPE_PERMISSION:
      if (!['permission_1', 'permission_2', 'permission_3', 'permission_4', 'permission_5', 'permission_6'].includes(input)) {
        await sendPermissionList(from);
        return;
      }

      session.request.var_type_permission = input.replace('permission_', '');

      if (session.request.var_type_permission === '6') {
        session.step = STEPS.CUSTOM_REASON;
        saveSession(from, session);
        await sendTextMessage(from, 'Escribe el *motivo* del permiso');
        return;
      }

      session.request.var_reason = mapPermission(session.request.var_type_permission);
      if (['4', '5'].includes(session.request.var_type_permission)) {
        session.request.var_medical_certificate = true;
      }

      session.step = session.request.var_days_hours === '1' ? STEPS.START_DATE : STEPS.START_HOUR;
      saveSession(from, session);

      await sendTextMessage(
        from,
        session.request.var_days_hours === '1'
          ? 'Escribe la *fecha de inicio* en formato DD-MM-YYYY'
          : 'Escribe la *hora de inicio* en formato DD-MM-YYYY HH:mm'
      );
      return;

    case STEPS.CUSTOM_REASON:
      session.request.var_reason = plainText.slice(0, 250);
      session.step = session.request.var_days_hours === '1' ? STEPS.START_DATE : STEPS.START_HOUR;
      saveSession(from, session);
      await sendTextMessage(
        from,
        session.request.var_days_hours === '1'
          ? 'Escribe la *fecha de inicio* en formato DD-MM-YYYY'
          : 'Escribe la *hora de inicio* en formato DD-MM-YYYY HH:mm'
      );
      return;

    case STEPS.START_DATE: {
      const start = parseDate(plainText);
      if (!start || isWeekend(start)) {
        await sendTextMessage(from, 'Fecha inválida o fin de semana. Usa DD-MM-YYYY');
        return;
      }
      session.request.var_start_date = start.format('DD-MM-YYYY');
      session.step = STEPS.END_DATE;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe la *fecha final* en formato DD-MM-YYYY');
      return;
    }

    case STEPS.END_DATE: {
      const end = parseDate(plainText);
      const start = parseDate(session.request.var_start_date);
      if (!end || !start || isWeekend(end) || end.isBefore(start, 'day')) {
        await sendTextMessage(from, 'Fecha final inválida');
        return;
      }

      const daysRequested = calculateWorkingDays(session.request.var_start_date, end.format('DD-MM-YYYY'));

      if (session.request.var_type_request === '1') {
        const balance = Number(session.request.var_balance || 0);
        if (daysRequested > balance) {
          await sendTextMessage(from, 'Has solicitado más días de los disponibles');
          return;
        }
      }

      session.request.var_end_date = end.format('DD-MM-YYYY');
      session.request.var_days_requested = String(daysRequested);
      session.step = STEPS.COMMENTS;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe un *comentario* o responde *no*');
      return;
    }

    case STEPS.START_HOUR: {
      const startHour = parseDateTime(plainText);
      if (!startHour || isWeekend(startHour)) {
        await sendTextMessage(from, 'Hora inválida. Usa DD-MM-YYYY HH:mm');
        return;
      }
      session.request.var_start_hour = startHour.format('DD-MM-YYYY HH:mm');
      session.step = STEPS.END_HOUR;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe la *hora final* en formato DD-MM-YYYY HH:mm');
      return;
    }

    case STEPS.END_HOUR: {
      const endHour = parseDateTime(plainText);
      if (!endHour) {
        await sendTextMessage(from, 'Hora inválida. Usa DD-MM-YYYY HH:mm');
        return;
      }

      const hours = calculateHours(session.request.var_start_hour, endHour.format('DD-MM-YYYY HH:mm'));
      if (!hours) {
        await sendTextMessage(from, 'Horario inválido. Debe ser el mismo día y máximo 8 horas');
        return;
      }

      if (session.request.var_type_request === '1') {
        const equivalentDays = Number((hours / 8).toFixed(1));
        const balance = Number(session.request.var_balance || 0);
        if (equivalentDays > balance) {
          await sendTextMessage(from, 'Las horas solicitadas superan tu saldo disponible');
          return;
        }
      }

      session.request.var_end_hour = endHour.format('DD-MM-YYYY HH:mm');
      session.request.var_hour_requested = String(hours);
      session.step = STEPS.COMMENTS;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe un *comentario* o responde *no*');
      return;
    }

    case STEPS.COMMENTS:
      session.request.var_requester_comment = inputLower === 'no' ? '' : plainText;

      if (session.request.var_medical_certificate) {
        session.step = STEPS.MEDICAL_CERTIFICATE;
        saveSession(from, session);
        await sendButtonsMessage(from, 'Este permiso requiere certificado médico. ¿Deseas marcarlo?', [
          { id: 'medical_yes', title: 'Sí' },
          { id: 'medical_pending', title: 'Pendiente' }
        ]);
        return;
      }

      session.step = STEPS.CONFIRM;
      saveSession(from, session);
      await sendButtonsMessage(from, `${buildSummary(session)}\n\n¿Confirmar solicitud?`, [
        { id: 'confirm_yes', title: 'Confirmar' },
        { id: 'confirm_cancel', title: 'Cancelar' }
      ]);
      return;

    case STEPS.MEDICAL_CERTIFICATE:
      if (!['medical_yes', 'medical_pending'].includes(input)) {
        await sendTextMessage(from, 'Selecciona una opción válida');
        return;
      }
      session.request.var_medical_certificate = true;
      session.step = STEPS.CONFIRM;
      saveSession(from, session);
      await sendButtonsMessage(from, `${buildSummary(session)}\n\n¿Confirmar solicitud?`, [
        { id: 'confirm_yes', title: 'Confirmar' },
        { id: 'confirm_cancel', title: 'Cancelar' }
      ]);
      return;

    case STEPS.CONFIRM:
      if (input === 'confirm_cancel') {
        clearSession(from);
        await sendTextMessage(from, 'Solicitud cancelada correctamente');
        return;
      }

      if (input !== 'confirm_yes' && inputLower !== 'confirmar') {
        await sendTextMessage(from, 'Pulsa Confirmar o Cancelar');
        return;
      }

      const requestId = uuidv4();
      const payload = {
        request_id: requestId,
        created_at: new Date().toISOString(),
        source: 'whatsapp-cloud-api',
        employee: session.employee,
        request: {
          ...session.request,
          var_type_request_label: mapTypeRequest(session.request.var_type_request),
          var_days_hours_label: mapUnit(session.request.var_days_hours),
          var_type_permission_label: mapPermission(session.request.var_type_permission)
        },
        processmaker_payload: {
          var_requested_date: session.request.var_requested_date,
          var_firstname: session.employee.var_firstname,
          var_lastname: session.employee.var_lastname,
          var_mail: session.employee.var_mail,
          var_area: session.employee.var_area,
          var_position: session.employee.var_position,
          var_area_director: session.employee.var_area_director,
          var_contract_type: session.employee.var_contract_type,
          var_user_name: session.employee.var_user_name,
          var_type_request: session.request.var_type_request,
          var_days_hours: session.request.var_days_hours,
          var_type_permission: session.request.var_type_permission,
          var_reason: session.request.var_reason,
          var_balance: session.request.var_balance,
          var_start_date: session.request.var_start_date,
          var_end_date: session.request.var_end_date,
          var_days_requested: session.request.var_days_requested,
          var_start_hour: session.request.var_start_hour,
          var_end_hour: session.request.var_end_hour,
          var_hour_requested: session.request.var_hour_requested,
          var_requester_comment: session.request.var_requester_comment,
          var_medical_certificate: session.request.var_medical_certificate
        }
      };

      saveEmployee({ ...session.employee, phone: from });
      saveRequest(requestId, payload);
      await sendRequestEmail(payload);

      clearSession(from);
      await sendTextMessage(from, `Tu solicitud fue registrada correctamente ✅\nID: ${requestId}\nTambién se envió el resumen por correo`);
      return;

    default:
      clearSession(from);
      await sendMainMenu(from);
  }
}

module.exports = {
  processMessage
};