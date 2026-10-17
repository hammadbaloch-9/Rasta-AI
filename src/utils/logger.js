const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

let currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;

const emit = (level, message, meta) => {
  if ((LEVELS[level] ?? LEVELS.info) > currentLevel) return;
  const line = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
};

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
  setLevel(level) {
    currentLevel = LEVELS[level] ?? currentLevel;
  },
};

export default logger;
