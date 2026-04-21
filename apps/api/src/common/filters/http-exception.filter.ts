import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const isProd = process.env.NODE_ENV === 'production';

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const payload = typeof res === 'string' ? { message: res } : (res as Record<string, unknown>);
      response.status(status).json({
        statusCode: status,
        ...payload,
        requestId: response.getHeader('X-Request-ID'),
        ...(isProd ? {} : { path: request.url }),
      });
      return;
    }

    if (exception instanceof MulterError) {
      if (exception.code === 'LIMIT_FILE_SIZE') {
        response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          message: 'File exceeds maximum allowed size',
          requestId: response.getHeader('X-Request-ID'),
          ...(isProd ? {} : { path: request.url }),
        });
        return;
      }
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: exception.message,
        requestId: response.getHeader('X-Request-ID'),
        ...(isProd ? {} : { path: request.url }),
      });
      return;
    }

    const err = exception as Error;
    this.logger.error(err?.message ?? 'Unhandled error', err?.stack, `${request.method} ${request.url}`);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      requestId: response.getHeader('X-Request-ID'),
    });
  }
}
