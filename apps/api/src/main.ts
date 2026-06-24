import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from './logger';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger });
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Application listening on port ${port}`);
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
