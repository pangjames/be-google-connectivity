import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import databaseConfig from './config/database.config';
import { AppService } from './app.service';
import { GoogleHotelModule } from './google-hotel/google-hotel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...configService.get('database'),
      }),
    }),
    ScheduleModule.forRoot(),
    GoogleHotelModule,
  ],
  controllers: [], 
  providers: [AppService],
})
export class AppModule {}