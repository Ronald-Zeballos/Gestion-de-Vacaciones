const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const DATE_FORMAT = 'DD-MM-YYYY';
const DATETIME_FORMAT = 'DD-MM-YYYY HH:mm';
const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const WEEKDAY_LONG = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miercoles',
  'Jueves',
  'Viernes',
  'Sabado'
];

function normalizeText(value) {
  return String(value || '').trim();
}

function todayDate() {
  return dayjs().format(DATE_FORMAT);
}

function parseDate(input) {
  const value = dayjs(input, [DATE_FORMAT, 'YYYY-MM-DD'], true);
  return value.isValid() ? value : null;
}

function parseDateTime(input) {
  const value = dayjs(
    input,
    [DATETIME_FORMAT, 'YYYY-MM-DD HH:mm', 'YYYY-MM-DDTHH:mm'],
    true
  );
  return value.isValid() ? value : null;
}

function isWeekend(dateObj) {
  const day = dateObj.day();
  return day === 0 || day === 6;
}

function calculateWorkingDays(startDateStr, endDateStr) {
  const start = parseDate(startDateStr);
  const end = parseDate(endDateStr);

  if (!start || !end || end.isBefore(start, 'day')) return 0;

  let current = start.clone();
  let count = 0;

  while (current.isSame(end, 'day') || current.isBefore(end, 'day')) {
    if (!isWeekend(current)) count += 1;
    current = current.add(1, 'day');
  }

  return count;
}

function parseDateOptionId(value) {
  const normalizedValue = normalizeText(value);
  const match = /^date_(\d{4}-\d{2}-\d{2})$/i.exec(normalizedValue);

  if (!match) {
    return null;
  }

  return parseDate(match[1]);
}

function formatWorkingDayTitle(dateObj) {
  return `${WEEKDAY_SHORT[dateObj.day()]} ${dateObj.format('DD/MM')}`;
}

function formatWorkingDayDescription(dateObj) {
  return `${WEEKDAY_LONG[dateObj.day()]} ${dateObj.format('DD-MM-YYYY')}`;
}

function buildNextWorkingDaysOptions(days = 14, startFrom = null) {
  const baseDate = startFrom ? parseDate(startFrom) : dayjs();
  let current = (baseDate || dayjs()).startOf('day');
  const options = [];

  while (options.length < days) {
    if (!isWeekend(current)) {
      options.push({
        id: `date_${current.format('YYYY-MM-DD')}`,
        title: formatWorkingDayTitle(current),
        description: formatWorkingDayDescription(current),
        date: current.format(DATE_FORMAT),
        isoDate: current.format('YYYY-MM-DD')
      });
    }

    current = current.add(1, 'day');
  }

  return options;
}

function describeHttpError(error) {
  const status = Number(error?.response?.status || 0) || null;
  const code = error?.code || null;
  const responseData = error?.response?.data || null;
  const message =
    responseData?.error?.message ||
    responseData?.message ||
    error?.message ||
    'Unknown error';

  return {
    status,
    code,
    message,
    data: responseData,
    isTimeout: code === 'ECONNABORTED' || /timeout/i.test(message)
  };
}

function getHttpStatusFromError(error, fallbackStatus = 500) {
  const status = Number(error?.response?.status || 0);

  if (status >= 400 && status < 600) {
    return status;
  }

  if (status === 302) {
    return 403;
  }

  if (error?.code === 'ECONNABORTED') {
    return 504;
  }

  return fallbackStatus;
}

module.exports = {
  DATE_FORMAT,
  DATETIME_FORMAT,
  normalizeText,
  todayDate,
  parseDate,
  parseDateTime,
  parseDateOptionId,
  isWeekend,
  calculateWorkingDays,
  buildNextWorkingDaysOptions,
  describeHttpError,
  getHttpStatusFromError
};
