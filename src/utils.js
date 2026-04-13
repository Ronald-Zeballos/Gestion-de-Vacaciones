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
  isWeekend,
  calculateWorkingDays,
  describeHttpError,
  getHttpStatusFromError
};
