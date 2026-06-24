import { ConsoleLogger } from '@nestjs/common';

export class Logger extends ConsoleLogger {
  constructor(context?: string) {
    super(context, {
      logLevels:
        process.env.NODE_ENV === 'production'
          ? ['log', 'error', 'warn']
          : ['log', 'error', 'warn', 'debug', 'verbose'],
    });
  }
}
