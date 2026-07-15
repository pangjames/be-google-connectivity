import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Google Hotel ARI Sync Engine')
    .setDescription('Push-based ARI delivery model for Google Hotel Ads')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  // await app.listen(process.env.PORT || 3000);
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const host = process.env.HOST || '0.0.0.0'; 
  await app.listen(port, host);
}
bootstrap();
