import { ArgumentsHost, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

// Why: a phone cancelling an image request (FlatList recycling,
// screen change) while the photo proxy is still downloading makes
// stream.pipeline() throw ERR_STREAM_UNABLE_TO_PIPE synchronously inside
// the Nest reply. That must never be logged as a 500-class ERROR, while
// real failures must keep their loud handling.
describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let response: { status: jest.Mock; json: jest.Mock };
  let request: { method: string; url: string };
  let host: ArgumentsHost;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    request = { method: 'GET', url: '/api/v1/places/photo/qp-sona' };
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps replying to HttpExceptions with the JSON error body', () => {
    filter.catch(new NotFoundException('Unknown place photo'), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Unknown place photo',
        path: request.url,
      }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('still logs unknown errors at ERROR and replies 500', () => {
    filter.catch(new Error('boom'), host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error' }),
    );
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('drops ERR_STREAM_UNABLE_TO_PIPE at debug when the client already left', () => {
    const pipeError = new Error('Cannot pipe to a closed or destroyed stream') as Error & {
      code: string;
    };
    pipeError.code = 'ERR_STREAM_UNABLE_TO_PIPE';

    filter.catch(pipeError, host);

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    // No response write: the socket is already gone.
    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });
});
