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

    // Map PostgreSQL error codes to meaningful HTTP responses so clients see
    // 409/400 instead of a cryptic 500 for data-integrity violations.
    const err = exception as Error & { code?: string; detail?: string; table?: string; column?: string };
    if (err?.code) {
      this.logger.warn(
        `pg error ${err.code} on ${request.method} ${request.url}: ${err.message}${err.detail ? ' | ' + err.detail : ''}`,
      );
    }
    if (err?.code) {
      // 23505 = unique_violation, 23503 = foreign_key_violation,
      // 23502 = not_null_violation, 23514 = check_violation
      if (err.code === '23505') {
        response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: 'A record with these values already exists.',
          requestId: response.getHeader('X-Request-ID'),
          ...(isProd ? {} : { detail: err.message, path: request.url }),
        });
        return;
      }
      if (err.code === '23503') {
        response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: 'Referenced record does not exist.',
          requestId: response.getHeader('X-Request-ID'),
          ...(isProd ? {} : { detail: err.message, path: request.url }),
        });
        return;
      }
      if (err.code === '23502' || err.code === '23514') {
        response.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid data — required field missing or constraint violated.',
          requestId: response.getHeader('X-Request-ID'),
          ...(isProd ? {} : { detail: err.message, path: request.url }),
        });
        return;
      }
    }

    this.logger.error(err?.message ?? 'Unhandled error', err?.stack, `${request.method} ${request.url}`);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      requestId: response.getHeader('X-Request-ID'),
    });
  }
}
