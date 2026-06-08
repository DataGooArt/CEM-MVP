import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn', 'debug'] });

  // Habilitar body parsing para text/plain y XML (usado por el collector upload)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express');
  app.use(express.text({ type: ['text/plain', 'application/xml', 'text/xml'], limit: '50mb' }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });

  // Swagger siempre activo (documentación interna — desactivar con SWAGGER_DISABLED=true en prod)
  if (process.env.SWAGGER_DISABLED !== 'true') {
    const config = new DocumentBuilder()
      .setTitle('CEM API')
      .setDescription('Cyber Exposure Management — REST API')
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-collector-id' }, 'collector-key')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    Logger.log('Swagger docs available at /api/docs', 'Bootstrap');
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  await app.listen(port);
  Logger.log(`API running on port ${port}`, 'Bootstrap');
}
bootstrap();
