const { sendTextMessage, sendButtonsMessage, sendListMessage } = require('./whatsapp');
const { getSession, saveSession, clearSession } = require('./storage');

const STEPS = {
  START: 'START',
  FULL_NAME: 'FULL_NAME',
  EMAIL: 'EMAIL',
  TYPE_REQUEST: 'TYPE_REQUEST',
  UNIT_TIME: 'UNIT_TIME',
  TYPE_PERMISSION: 'TYPE_PERMISSION',
  COMMENTS: 'COMMENTS',
  CONFIRM: 'CONFIRM'
};

function buildSession(phone) {
  return {
    phone,
    step: STEPS.START,
    data: {
      full_name: '',
      email: '',
      type_request: '',
      unit_time: '',
      type_permission: '',
      comments: ''
    }
  };
}

async function startMenu(to) {
  await sendButtonsMessage(
    to,
    'Hola 👋\nSoy el asistente de solicitudes de vacaciones y permisos\n\n¿Qué deseas hacer?',
    [
      { id: 'start_request', title: 'Iniciar' },
      { id: 'see_requirements', title: 'Requisitos' },
      { id: 'cancel_flow', title: 'Cancelar' }
    ]
  );
}

async function processMessage(message) {
  const { from, text, interactiveId } = message;
  let session = getSession(from);

  if (!session) {
    session = buildSession(from);
    saveSession(from, session);
    await startMenu(from);
    return;
  }

  const input = interactiveId || text?.trim();

  if (input === 'cancel_flow' || String(input).toLowerCase() === 'cancelar') {
    clearSession(from);
    await sendTextMessage(from, 'Solicitud cancelada correctamente');
    return;
  }

  switch (session.step) {
    case STEPS.START:
      if (input === 'see_requirements') {
        await sendTextMessage(
          from,
          'Requisitos:\n- Nombre completo\n- Correo corporativo\n- Datos de la solicitud\n- Certificado médico si corresponde'
        );
        await startMenu(from);
        return;
      }

      if (input === 'start_request') {
        session.step = STEPS.FULL_NAME;
        saveSession(from, session);
        await sendTextMessage(from, 'Perfecto ✅\nEscribe tu *nombre completo*');
        return;
      }

      await startMenu(from);
      return;

    case STEPS.FULL_NAME:
      session.data.full_name = text.trim();
      session.step = STEPS.EMAIL;
      saveSession(from, session);
      await sendTextMessage(from, 'Ahora escribe tu *correo corporativo*');
      return;

    case STEPS.EMAIL:
      session.data.email = text.trim();
      session.step = STEPS.TYPE_REQUEST;
      saveSession(from, session);

      await sendListMessage(
        from,
        'Selecciona el tipo de solicitud',
        'Ver opciones',
        [
          {
            title: 'Tipos de solicitud',
            rows: [
              { id: 'type_vacaciones', title: 'Vacaciones', description: 'Solicitud de vacaciones' },
              { id: 'type_permiso', title: 'Permiso', description: 'Solicitud de permiso' }
            ]
          }
        ]
      );
      return;

    case STEPS.TYPE_REQUEST:
      if (!['type_vacaciones', 'type_permiso'].includes(input)) {
        await sendTextMessage(from, 'Selecciona una opción válida de la lista');
        return;
      }

      session.data.type_request = input === 'type_vacaciones' ? 'Vacaciones' : 'Permiso';
      session.step = STEPS.UNIT_TIME;
      saveSession(from, session);

      await sendButtonsMessage(
        from,
        'Selecciona la unidad de tiempo',
        [
          { id: 'unit_days', title: 'Días' },
          { id: 'unit_hours', title: 'Horas' }
        ]
      );
      return;

    case STEPS.UNIT_TIME:
      if (!['unit_days', 'unit_hours'].includes(input)) {
        await sendTextMessage(from, 'Selecciona una opción válida');
        return;
      }

      session.data.unit_time = input === 'unit_days' ? 'Días' : 'Horas';

      if (session.data.type_request === 'Permiso') {
        session.step = STEPS.TYPE_PERMISSION;
        saveSession(from, session);

        await sendListMessage(
          from,
          'Selecciona el tipo de permiso',
          'Ver permisos',
          [
            {
              title: 'Permisos',
              rows: [
                { id: 'perm_1', title: 'Fallecimiento', description: 'Padres, cónyuge, hijos, hermanos' },
                { id: 'perm_2', title: 'Cumpleaños', description: 'Media jornada' },
                { id: 'perm_3', title: 'Matrimonio', description: '3 días laborales' },
                { id: 'perm_4', title: 'Salud', description: 'Requiere certificado médico' },
                { id: 'perm_5', title: 'Maternidad', description: 'Requiere certificado médico' },
                { id: 'perm_6', title: 'Otros', description: 'Motivo personalizado' }
              ]
            }
          ]
        );
        return;
      }

      session.step = STEPS.COMMENTS;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe un comentario o detalle de tu solicitud');
      return;

    case STEPS.TYPE_PERMISSION:
      session.data.type_permission = input;
      session.step = STEPS.COMMENTS;
      saveSession(from, session);
      await sendTextMessage(from, 'Escribe un comentario o motivo de tu solicitud');
      return;

    case STEPS.COMMENTS:
      session.data.comments = text.trim();
      session.step = STEPS.CONFIRM;
      saveSession(from, session);

      await sendButtonsMessage(
        from,
        `Confirma tu solicitud:\n\nNombre: ${session.data.full_name}\nCorreo: ${session.data.email}\nTipo: ${session.data.type_request}\nUnidad: ${session.data.unit_time}\nComentario: ${session.data.comments}`,
        [
          { id: 'confirm_request', title: 'Confirmar' },
          { id: 'cancel_flow', title: 'Cancelar' }
        ]
      );
      return;

    case STEPS.CONFIRM:
      if (input !== 'confirm_request') {
        await sendTextMessage(from, 'Pulsa Confirmar o Cancelar');
        return;
      }

      clearSession(from);
      await sendTextMessage(from, 'Tu solicitud fue registrada correctamente ✅');
      return;

    default:
      clearSession(from);
      await startMenu(from);
      return;
  }
}

module.exports = {
  processMessage
};