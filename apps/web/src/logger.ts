type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevelName, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVELS: Record<string, LogLevelName> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

function getConfiguredLevel(): number {
  if (import.meta.env.PROD) {
    return LOG_LEVEL_PRIORITY.warn;
  }
  const envLevel = import.meta.env.VITE_LOG_LEVEL as string | undefined;
  const level = envLevel ? LEVELS[envLevel] : undefined;
  return level ? LOG_LEVEL_PRIORITY[level] : LOG_LEVEL_PRIORITY.debug;
}

let currentLevel = getConfiguredLevel();

export function setLogLevel(level: LogLevelName): void {
  currentLevel = LOG_LEVEL_PRIORITY[level];
}

export class Logger {
  private readonly context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  /** Create a new Logger instance scoped to the given context. */
  forContext(context: string): Logger {
    return new Logger(context);
  }

  private prefix(level: string): string {
    const timestamp = new Date().toISOString();
    const ctx = this.context ? ` [${this.context}]` : '';
    return `${timestamp} [${level}]${ctx}`;
  }

  debug(message: string): void {
    if (currentLevel <= LOG_LEVEL_PRIORITY.debug) {
      console.debug(this.prefix('DEBUG'), message);
    }
  }

  info(message: string): void {
    if (currentLevel <= LOG_LEVEL_PRIORITY.info) {
      console.info(this.prefix('INFO'), message);
    }
  }

  warn(message: string): void {
    if (currentLevel <= LOG_LEVEL_PRIORITY.warn) {
      console.warn(this.prefix('WARN'), message);
    }
  }

  error(message: string, error?: unknown): void {
    if (currentLevel <= LOG_LEVEL_PRIORITY.error) {
      console.error(this.prefix('ERROR'), message);
      if (error) {
        console.error(error);
      }
    }
  }
}

export const logger = new Logger();
