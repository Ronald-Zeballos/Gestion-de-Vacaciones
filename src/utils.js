const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const DATE_FORMAT = 'DD-MM-YYYY';
const DATETIME_FORMAT = 'DD-MM-YYYY HH:mm';

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

function calculateHours(startDateTimeStr, endDateTimeStr) {
  const start = parseDateTime(startDateTimeStr);
  const end = parseDateTime(endDateTimeStr);

  if (!start || !end) return null;
  if (!start.isSame(end, 'day')) return null;
  if (end.isBefore(start)) return null;
  if (isWeekend(start) || isWeekend(end)) return null;

  const diffMinutes = end.diff(start, 'minute');
  const hours = diffMinutes / 60;

  if (hours <= 0 || hours > 8) return null;

  return Math.ceil(hours);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function mapTypeRequest(value) {
  const map = {
    '1': 'Vacaciones',
    '2': 'Permiso'
  };
  return map[value] || '';
}

function mapUnit(value) {
  const map = {
    '1': 'Días',
    '2': 'Horas'
  };
  return map[value] || '';
}

function mapPermission(value) {
  const map = {
    '1': 'Fallecimiento',
    '2': 'Cumpleaños',
    '3': 'Matrimonio',
    '4': 'Salud',
    '5': 'Maternidad',
    '6': 'Otros'
  };
  return map[value] || '';
}

module.exports = {
  DATE_FORMAT,
  DATETIME_FORMAT,
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
};