const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

const DATE_FORMAT = 'DD-MM-YYYY';
const DATETIME_FORMAT = 'DD-MM-YYYY HH:mm';
const TIME_FORMAT = 'HH:mm';
const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];
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

function parseTime(input) {
  const value = dayjs(input, [TIME_FORMAT, 'H:mm'], true);
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

function parseDateFromInput(input, text) {
  const dateFromId = parseDateOptionId(input);

  if (dateFromId) {
    return dateFromId.format(DATE_FORMAT);
  }

  const dateFromText = parseDate(text);
  return dateFromText ? dateFromText.format(DATE_FORMAT) : '';
}

function parseMonthOptionId(value) {
  const normalizedValue = normalizeText(value);
  const match = /^month_(\d{4}-\d{2})$/i.exec(normalizedValue);

  if (!match) {
    return null;
  }

  const monthValue = dayjs(`${match[1]}-01`, 'YYYY-MM-DD', true);
  return monthValue.isValid() ? monthValue.startOf('month') : null;
}

function parseMonthPageOptionId(value) {
  const normalizedValue = normalizeText(value);
  const match = /^monthpage_(\d+)$/i.exec(normalizedValue);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function formatMonthLabel(monthValue) {
  const monthDate = typeof monthValue === 'string'
    ? dayjs(`${monthValue}-01`, 'YYYY-MM-DD', true)
    : monthValue;

  if (!monthDate?.isValid?.()) {
    return '';
  }

  return `${MONTH_NAMES[monthDate.month()]} ${monthDate.format('YYYY')}`;
}

function buildUpcomingMonthRows(totalMonths = 12, startFrom = null, page = 0, pageSize = 6) {
  const baseDate = startFrom ? parseDate(startFrom) : dayjs();
  const monthStart = (baseDate || dayjs()).startOf('month');
  const safePage = Number(page) >= 0 ? Number(page) : 0;
  const safePageSize = Number(pageSize) > 0 ? Number(pageSize) : 6;
  const months = [];

  for (let offset = 0; offset < totalMonths; offset += 1) {
    const currentMonth = monthStart.add(offset, 'month');
    months.push({
      id: `month_${currentMonth.format('YYYY-MM')}`,
      title: formatMonthLabel(currentMonth),
      description: `Seleccionar ${MONTH_NAMES[currentMonth.month()].toLowerCase()}`
    });
  }

  const startIndex = safePage * safePageSize;
  const rows = months.slice(startIndex, startIndex + safePageSize);

  if (startIndex > 0) {
    rows.push({
      id: `monthpage_${safePage - 1}`,
      title: 'Meses anteriores',
      description: 'Ver meses anteriores'
    });
  }

  if (startIndex + safePageSize < months.length) {
    rows.push({
      id: `monthpage_${safePage + 1}`,
      title: 'Mas meses',
      description: 'Ver meses siguientes'
    });
  }

  return rows;
}

function parseDayBlockOptionId(value) {
  const normalizedValue = normalizeText(value);
  const match = /^dayblock_(\d{4}-\d{2})_(\d)$/i.exec(normalizedValue);

  if (!match) {
    return null;
  }

  return {
    monthKey: match[1],
    blockIndex: Number(match[2])
  };
}

function getSelectableMonthDays(monthKey, minDateStr = null) {
  const monthDate = dayjs(`${monthKey}-01`, 'YYYY-MM-DD', true);

  if (!monthDate.isValid()) {
    return [];
  }

  const minDate = minDateStr ? parseDate(minDateStr) : null;
  const monthEnd = monthDate.endOf('month');
  const days = [];
  let current = monthDate.clone();

  while (current.isSame(monthEnd, 'day') || current.isBefore(monthEnd, 'day')) {
    const isAfterMinimum = !minDate || current.isSame(minDate, 'day') || current.isAfter(minDate, 'day');

    if (!isWeekend(current) && isAfterMinimum) {
      days.push(current.clone());
    }

    current = current.add(1, 'day');
  }

  return days;
}

function buildDayBlockRows(monthKey, minDateStr = null) {
  const monthDate = dayjs(`${monthKey}-01`, 'YYYY-MM-DD', true);

  if (!monthDate.isValid()) {
    return [];
  }

  const selectableDays = getSelectableMonthDays(monthKey, minDateStr);
  const blocks = [
    { index: 0, start: 1, end: 10 },
    { index: 1, start: 11, end: 20 },
    { index: 2, start: 21, end: monthDate.daysInMonth() }
  ];

  return blocks.flatMap((block) => {
    const blockDays = selectableDays.filter((day) => {
      const currentDate = day.date();
      return currentDate >= block.start && currentDate <= block.end;
    });

    if (!blockDays.length) {
      return [];
    }

    return [{
      id: `dayblock_${monthKey}_${block.index}`,
      title: `Dias ${String(block.start).padStart(2, '0')}-${String(block.end).padStart(2, '0')}`,
      description: `${blockDays.length} dias habil(es) disponibles`
    }];
  });
}

function buildMonthDayRows(monthKey, blockIndex, minDateStr = null) {
  const blocks = [
    { start: 1, end: 10 },
    { start: 11, end: 20 },
    { start: 21, end: 31 }
  ];
  const selectedBlock = blocks[Number(blockIndex)];

  if (!selectedBlock) {
    return [];
  }

  return getSelectableMonthDays(monthKey, minDateStr)
    .filter((day) => {
      const currentDate = day.date();
      return currentDate >= selectedBlock.start && currentDate <= selectedBlock.end;
    })
    .map((day) => ({
      id: `date_${day.format('YYYY-MM-DD')}`,
      title: day.format(DATE_FORMAT),
      description: WEEKDAY_LONG[day.day()] || WEEKDAY_SHORT[day.day()] || 'Dia habil'
    }));
}

function parseTimeOptionId(value) {
  const normalizedValue = normalizeText(value);
  const match = /^time_(\d{2}:\d{2})$/i.exec(normalizedValue);

  if (!match) {
    return null;
  }

  return parseTime(match[1]);
}

function parseTimeBlockOptionId(value) {
  const normalizedValue = normalizeText(value);
  const match = /^timeblock_(\d+)$/i.exec(normalizedValue);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function buildTimeSlots(startTime = '08:00', endTime = '18:00', intervalMinutes = 30, minTime = null) {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const minimum = minTime ? parseTime(minTime) : null;

  if (!start || !end || !intervalMinutes) {
    return [];
  }

  const slots = [];
  let current = start.clone();

  while (current.isSame(end) || current.isBefore(end)) {
    const isAfterMinimum = !minimum || current.isAfter(minimum);

    if (isAfterMinimum) {
      slots.push(current.format(TIME_FORMAT));
    }

    current = current.add(intervalMinutes, 'minute');
  }

  return slots;
}

function buildTimeBlockRows(minTime = null, blockSize = 7) {
  const slots = buildTimeSlots('08:00', '18:00', 30, minTime);
  const safeBlockSize = Number(blockSize) > 0 ? Number(blockSize) : 7;
  const rows = [];

  for (let startIndex = 0; startIndex < slots.length; startIndex += safeBlockSize) {
    const block = slots.slice(startIndex, startIndex + safeBlockSize);

    if (!block.length) {
      continue;
    }

    rows.push({
      id: `timeblock_${rows.length}`,
      title: `${block[0]} - ${block[block.length - 1]}`,
      description: `${block.length} horarios disponibles`
    });
  }

  return rows;
}

function buildTimeRows(blockIndex, minTime = null, blockSize = 7) {
  const slots = buildTimeSlots('08:00', '18:00', 30, minTime);
  const safeBlockSize = Number(blockSize) > 0 ? Number(blockSize) : 7;
  const safeIndex = Number(blockIndex) >= 0 ? Number(blockIndex) : 0;
  const block = slots.slice(safeIndex * safeBlockSize, (safeIndex + 1) * safeBlockSize);

  return block.map((timeValue) => ({
    id: `time_${timeValue}`,
    title: timeValue,
    description: 'Seleccionar hora'
  }));
}

function calculateRequestedHours(startTimeStr, endTimeStr) {
  const start = parseTime(startTimeStr);
  const end = parseTime(endTimeStr);

  if (!start || !end || !end.isAfter(start)) {
    return 0;
  }

  const durationMinutes = end.diff(start, 'minute');
  return Number((durationMinutes / 60).toFixed(2));
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

function buildNextWorkingDaysRows(days = 14, startFrom = null) {
  return buildNextWorkingDaysOptions(days, startFrom).map((option) => ({
    id: option.id,
    title: option.date,
    description: WEEKDAY_SHORT[parseDate(option.date).day()] || 'Dia habil'
  }));
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
  TIME_FORMAT,
  normalizeText,
  todayDate,
  parseDate,
  parseDateTime,
  parseTime,
  parseDateOptionId,
  parseDateFromInput,
  parseMonthOptionId,
  parseMonthPageOptionId,
  formatMonthLabel,
  buildUpcomingMonthRows,
  parseDayBlockOptionId,
  buildDayBlockRows,
  buildMonthDayRows,
  parseTimeOptionId,
  parseTimeBlockOptionId,
  buildTimeBlockRows,
  buildTimeRows,
  isWeekend,
  calculateWorkingDays,
  calculateRequestedHours,
  buildNextWorkingDaysOptions,
  buildNextWorkingDaysRows,
  describeHttpError,
  getHttpStatusFromError
};
