const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const {
  getSession,
  saveSession,
  clearSession,
  saveEmployee,
  saveRequest
} = require('./storage');
const {
  sendTextMessage,
  sendButtonsMessage,
  sendListMessage
} = require('./whatsapp');
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

function buildInitialSession(phone) {
  return {
    phone,
    step: STEPS.MENU,
    startedAt: new Date().toISOString(),
    employee: {
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

  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

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

async function sendMainMenu(to) {
  await sendButtonsMessage(
    to,
    `Hola 👋\nSoy el asistente de *${config.companyName}* para solicitudes de vacaciones y permisos.\n\n¿Qué deseas hacer?`,
    [
      { id: 'menu_start', title: 'Iniciar' },
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
          {
            id: 'type_request_1',
            title: 'Vacaciones',
            description: 'Solicitud de vacaciones'
          },
          {
            id: 'type_request_2',
            title: 'Permiso',
            description: 'Solicitud de permiso'
          }
        ]
      }
    ]
  );
}

async function sendUnitButtons(to) {
  await sendButtonsMessage(
    to,
    'Selecciona la unidad de tiempo',
    [
      { id: 'unit_1', title: 'Días' },
      { id: 'unit_2', title: 'Horas' }
    ]
  );
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
          {
            id: 'permission_1',
            title: 'Fallecimiento',
            description: 'Padres, cónyuge, hijos, hermanos'
          },
          {
            id: 'permission_2',
            title: 'Cumpleaños',
            description: 'Media jornada'
          },
          {
            id: 'permission_3',
            title: 'Matrimonio',
            description: '3 días laborales'
          },
          {
            id: 'permission_4',
            title: 'Salud',
            description: 'Requiere certificado médico'
          },
          {
            id: 'permission_5',
            title: 'Maternidad',
            description: 'Requiere certificado médico'
          },
          {
            id: 'permission_6',
            title: 'Otros',
            description: 'Motivo personalizado'
          }
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
    r.var_days_hours === '1'
      ? `📅 Inicio: ${r.var_start_date}`
      : `🕐 Inicio: ${r.var_start_hour}`,
    r.var_days_hours === '1'
      ? `📅 Fin: ${r.var_end_date}`
      : `🕐 Fin: ${r.var_end_hour}`,
    r.var_days_hours === '1'
      ? `📆 Días solicitados: ${r.var_days_requested}`
      : `🕒 Horas solicitadas: ${r.var_hour_requested}`,
    `💬 Comentarios: ${r.var_requester_comment || 'Sin comentarios'}`,
    `🏥 Certificado médico: ${r.var_medical_certificate ? 'Sí' : 'No'}`
  ]
    .filter(Boolean)
    .join('\n');
}

async function notifyAdmin(payload) {
  if (!config.adminNotificationNumber) return;

  const fullName = [payload.employee.var_firstname, payload.employee.var_lastname]
    .filter(Boolean)
    .join(' ');

  await sendTextMessage(
    config.adminNotificationNumber,
    `Nueva solicitud registrada ✅\n\nID: ${payload.request_id}\nEmpleado: ${fullName}\nTipo: ${payload.request.var_type_request_label}\nUnidad: ${payload.request.var_days_hours_label}`
  );
}

async function processMessage(message) {
  const from = normalizeText(message.from);
  const input = getUserInput(message);
  const plainText = getUserText(message);
  const inputLower = input.toLowerCase();

  if (!from) return;

  if (inputLower === 'cancelar' || inputLower === 'menu_cancel') {
    clearSession(from);
    await sendTextMessage(from, 'Solicitud cancelada correctamente. Escribe cualquier mensaje para comenzar otra vez.');
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
      if (input === 'menu_info') {
        await sendTextMessage(
          from,
          '📌 *Requisitos*\n\n- Nombre completo\n- Correo corporativo\n- Usuario interno\n- Área, cargo y director\n- Tipo de solicitud\n- Fechas u horas\n- Certificado médico si corresponde'
        );
        await sendMainMenu(from);
        return;
      }

      if (input === 'menu_start' || inputLower === 'iniciar') {
        session.step = STEPS.FULL_NAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Perfecto ✅\n\nEscribe tu *nombre completo*');
        return;
      }

      await sendMainMenu(from);
      return;

    case STEPS.FULL_NAME: {
      const fullName = plainText;
      if (!fullName || fullName.length < 4) {
        await sendTextMessage(from, 'Por favor escribe tu nombre completo correctamente');
        return;
      }

      const { firstName, lastName } = splitFullName(fullName);
      session.employee.var_firstname = firstName;
      session.employee.var_lastname = lastName;
      session.step = STEPS.EMAIL;
      saveSession(from, session);

      await sendTextMessage(from, 'Ahora escribe tu *correo corporativo*');
      return;
    }

    case STEPS.EMAIL:
      if (!isValidEmail(plainText)) {
        await sendTextMessage(from, 'Correo inválido. Escríbelo con formato correcto, por ejemplo: nombre@empresa.com');
        return;
      }

      session.employee.var_mail = plainText;
      session.step = STEPS.USERNAME;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe tu *usuario interno* o username');
      return;

    case STEPS.USERNAME:
      if (!plainText) {
        await sendTextMessage(from, 'Por favor escribe tu usuario interno');
        return;
      }

      session.employee.var_user_name = plainText;
      session.step = STEPS.AREA;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe tu *área de trabajo*');
      return;

    case STEPS.AREA:
      if (!plainText) {
        await sendTextMessage(from, 'Por favor escribe tu área');
        return;
      }

      session.employee.var_area = plainText;
      session.step = STEPS.POSITION;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe tu *cargo*');
      return;

    case STEPS.POSITION:
      if (!plainText) {
        await sendTextMessage(from, 'Por favor escribe tu cargo');
        return;
      }

      session.employee.var_position = plainText;
      session.step = STEPS.DIRECTOR;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe el nombre de tu *director de área*');
      return;

    case STEPS.DIRECTOR:
      if (!plainText) {
        await sendTextMessage(from, 'Por favor escribe el nombre del director de área');
        return;
      }

      session.employee.var_area_director = plainText;
      session.step = STEPS.CONTRACT_TYPE;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe tu *tipo de contrato*');
      return;

    case STEPS.CONTRACT_TYPE:
      if (!plainText) {
        await sendTextMessage(from, 'Por favor escribe tu tipo de contrato');
        return;
      }

      session.employee.var_contract_type = plainText;
      session.step = STEPS.BALANCE;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe tu *saldo disponible* de vacaciones en número, por ejemplo 10');
      return;

    case STEPS.BALANCE:
      if (Number.isNaN(Number(plainText)) || Number(plainText) < 0) {
        await sendTextMessage(from, 'Saldo inválido. Escribe solo un número, por ejemplo 5 o 10');
        return;
      }

      session.request.var_balance = String(plainText);
      session.step = STEPS.TYPE_REQUEST;
      saveSession(from, session);

      await sendTypeRequestList(from);
      return;

    case STEPS.TYPE_REQUEST:
      if (!['type_request_1', 'type_request_2'].includes(input)) {
        await sendTextMessage(from, 'Selecciona el tipo de solicitud desde la lista');
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
        await sendTextMessage(from, 'Selecciona una opción válida');
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

      if (session.request.var_days_hours === '1') {
        await sendTextMessage(from, 'Escribe la *fecha de inicio* en formato DD-MM-YYYY');
      } else {
        await sendTextMessage(from, 'Escribe la *hora de inicio* en formato DD-MM-YYYY HH:mm');
      }
      return;

    case STEPS.TYPE_PERMISSION:
      if (
        ![
          'permission_1',
          'permission_2',
          'permission_3',
          'permission_4',
          'permission_5',
          'permission_6'
        ].includes(input)
      ) {
        await sendTextMessage(from, 'Selecciona un tipo de permiso válido desde la lista');
        await sendPermissionList(from);
        return;
      }

      session.request.var_type_permission = input.replace('permission_', '');

      if (session.request.var_type_permission === '6') {
        session.step = STEPS.CUSTOM_REASON;
        saveSession(from, session);
        await sendTextMessage(from, 'Escribe el *motivo* de tu permiso. Máximo 250 caracteres');
        return;
      }

      session.request.var_reason = mapPermission(session.request.var_type_permission);

      if (['4', '5'].includes(session.request.var_type_permission)) {
        session.request.var_medical_certificate = true;
      }

      session.step = session.request.var_days_hours === '1' ? STEPS.START_DATE : STEPS.START_HOUR;
      saveSession(from, session);

      if (session.request.var_days_hours === '1') {
        await sendTextMessage(from, 'Escribe la *fecha de inicio* en formato DD-MM-YYYY');
      } else {
        await sendTextMessage(from, 'Escribe la *hora de inicio* en formato DD-MM-YYYY HH:mm');
      }
      return;

    case STEPS.CUSTOM_REASON:
      if (!plainText) {
        await sendTextMessage(from, 'Por favor escribe el motivo del permiso');
        return;
      }

      session.request.var_reason = plainText.slice(0, 250);
      session.step = session.request.var_days_hours === '1' ? STEPS.START_DATE : STEPS.START_HOUR;
      saveSession(from, session);

      if (session.request.var_days_hours === '1') {
        await sendTextMessage(from, 'Escribe la *fecha de inicio* en formato DD-MM-YYYY');
      } else {
        await sendTextMessage(from, 'Escribe la *hora de inicio* en formato DD-MM-YYYY HH:mm');
      }
      return;

    case STEPS.START_DATE: {
      const start = parseDate(plainText);

      if (!start) {
        await sendTextMessage(from, 'Fecha inválida. Usa el formato DD-MM-YYYY');
        return;
      }

      if (isWeekend(start)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana. Ingresa una fecha laboral');
        return;
      }

      session.request.var_start_date = start.format('DD-MM-YYYY');
      session.step = STEPS.END_DATE;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe la *fecha de finalización* en formato DD-MM-YYYY');
      return;
    }

    case STEPS.END_DATE: {
      const end = parseDate(plainText);
      const start = parseDate(session.request.var_start_date);

      if (!end) {
        await sendTextMessage(from, 'Fecha inválida. Usa el formato DD-MM-YYYY');
        return;
      }

      if (isWeekend(end)) {
        await sendTextMessage(from, 'No se permiten fechas en fin de semana. Ingresa una fecha laboral');
        return;
      }

      if (!start || end.isBefore(start, 'day')) {
        await sendTextMessage(from, 'La fecha final no puede ser menor a la inicial');
        return;
      }

      const daysRequested = calculateWorkingDays(
        session.request.var_start_date,
        end.format('DD-MM-YYYY')
      );

      if (session.request.var_type_request === '1') {
        const balance = Number(session.request.var_balance || 0);
        if (daysRequested > balance) {
          await sendTextMessage(from, 'Has solicitado más días de los que tienes disponibles. Ingresa otra fecha final');
          return;
        }
      }

      session.request.var_end_date = end.format('DD-MM-YYYY');
      session.request.var_days_requested = String(daysRequested);
      session.step = STEPS.COMMENTS;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe *comentarios adicionales* o escribe *no* si no deseas agregar nada');
      return;
    }

    case STEPS.START_HOUR: {
      const startHour = parseDateTime(plainText);

      if (!startHour) {
        await sendTextMessage(from, 'Formato inválido. Usa DD-MM-YYYY HH:mm');
        return;
      }

      if (isWeekend(startHour)) {
        await sendTextMessage(from, 'No se permiten horarios en fin de semana');
        return;
      }

      session.request.var_start_hour = startHour.format('DD-MM-YYYY HH:mm');
      session.step = STEPS.END_HOUR;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe la *hora de finalización* en formato DD-MM-YYYY HH:mm');
      return;
    }

    case STEPS.END_HOUR: {
      const endHour = parseDateTime(plainText);

      if (!endHour) {
        await sendTextMessage(from, 'Formato inválido. Usa DD-MM-YYYY HH:mm');
        return;
      }

      const hours = calculateHours(
        session.request.var_start_hour,
        endHour.format('DD-MM-YYYY HH:mm')
      );

      if (!hours) {
        await sendTextMessage(from, 'Horario inválido. Debe ser el mismo día, no fin de semana y máximo 8 horas');
        return;
      }

      if (session.request.var_type_request === '1') {
        const equivalentDays = Number((hours / 8).toFixed(1));
        const balance = Number(session.request.var_balance || 0);

        if (equivalentDays > balance) {
          await sendTextMessage(from, 'Las horas solicitadas superan tu saldo disponible de vacaciones');
          return;
        }
      }

      session.request.var_end_hour = endHour.format('DD-MM-YYYY HH:mm');
      session.request.var_hour_requested = String(hours);
      session.step = STEPS.COMMENTS;
      saveSession(from, session);

      await sendTextMessage(from, 'Escribe *comentarios adicionales* o escribe *no* si no deseas agregar nada');
      return;
    }

    case STEPS.COMMENTS:
      session.request.var_requester_comment = inputLower === 'no' ? '' : plainText;

      if (session.request.var_medical_certificate) {
        session.step = STEPS.MEDICAL_CERTIFICATE;
        saveSession(from, session);

        await sendButtonsMessage(
          from,
          'Este tipo de permiso requiere certificado médico.\n\n¿Deseas marcarlo como adjunto/pendiente?',
          [
            { id: 'medical_yes', title: 'Sí' },
            { id: 'medical_pending', title: 'Pendiente' }
          ]
        );
        return;
      }

      session.step = STEPS.CONFIRM;
      saveSession(from, session);

      await sendButtonsMessage(
        from,
        `${buildSummary(session)}\n\n¿Deseas confirmar la solicitud?`,
        [
          { id: 'confirm_yes', title: 'Confirmar' },
          { id: 'confirm_cancel', title: 'Cancelar' }
        ]
      );
      return;

    case STEPS.MEDICAL_CERTIFICATE:
      if (!['medical_yes', 'medical_pending'].includes(input)) {
        await sendTextMessage(from, 'Selecciona una opción válida');
        return;
      }

      session.request.var_medical_certificate = true;
      session.step = STEPS.CONFIRM;
      saveSession(from, session);

      await sendButtonsMessage(
        from,
        `${buildSummary(session)}\n\n¿Deseas confirmar la solicitud?`,
        [
          { id: 'confirm_yes', title: 'Confirmar' },
          { id: 'confirm_cancel', title: 'Cancelar' }
        ]
      );
      return;

    case STEPS.CONFIRM:
      if (input === 'confirm_cancel') {
        clearSession(from);
        await sendTextMessage(from, 'Solicitud cancelada correctamente');
        return;
      }

      if (input !== 'confirm_yes' && inputLower !== 'confirmar') {
        await sendTextMessage(from, 'Pulsa *Confirmar* o *Cancelar*');
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

      saveEmployee(session.employee);
      saveRequest(requestId, payload);
      await notifyAdmin(payload);
      clearSession(from);

      await sendTextMessage(
        from,
        `Tu solicitud fue registrada correctamente ✅\n\nID: ${requestId}`
      );
      return;

    default:
      clearSession(from);
      await sendMainMenu(from);
  }
}

module.exports = {
  processMessage
};