import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;

    // The photo proxy replies only after async provider downloads, so the
    // phone may have cancelled the image (recycled list item / screen
    // change) by then: stream.pipeline() then throws synchronously inside
    // the Nest reply with ERR_STREAM_UNABLE_TO_PIPE. Nothing failed
    // server-side and a 500 into the closed socket is never delivered —
    // drop it at debug level instead of ERROR + stack.
    if (
      !isHttpException &&
      exception instanceof Error &&
      'code' in exception &&
      exception.code === 'ERR_STREAM_UNABLE_TO_PIPE'
    ) {
      this.logger.debug(
        `${request.method} ${request.url}: client disconnected before the response finished (ERR_STREAM_UNABLE_TO_PIPE); dropped, not a server error`,
      );
      return;
    }

    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = isHttpException ? exception.getResponse() : null;

    const message = isHttpException
      ? typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any)?.message ?? exception.message
      : 'Internal server error';

    if (!isHttpException) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
