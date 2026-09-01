import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import { Logger } from './logger';

describe('Logger', () => {
  let debugSpy: MockInstance;
  let infoSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to error level', () => {
    const logger = new Logger();

    logger.verbose('test debug');
    logger.info('test info');
    logger.error('test error');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[WorkerManager]', 'test error');
  });

  it('outputs all logs in verbose level', () => {
    const logger = new Logger('verbose');

    logger.verbose('test debug');
    logger.info('test info');
    logger.error('test error');

    expect(debugSpy).toHaveBeenCalledWith('[WorkerManager]', 'test debug');
    expect(infoSpy).toHaveBeenCalledWith('[WorkerManager]', 'test info');
    expect(errorSpy).toHaveBeenCalledWith('[WorkerManager]', 'test error');
  });

  it('outputs info and error in info level', () => {
    const logger = new Logger('info');

    logger.verbose('test debug');
    logger.info('test info');
    logger.error('test error');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('[WorkerManager]', 'test info');
    expect(errorSpy).toHaveBeenCalledWith('[WorkerManager]', 'test error');
  });

  it('outputs nothing in silent level', () => {
    const logger = new Logger('silent');

    logger.verbose('test debug');
    logger.info('test info');
    logger.error('test error');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('can dynamically change log levels via setLevel', () => {
    const logger = new Logger('error');

    logger.info('should be ignored');
    expect(infoSpy).not.toHaveBeenCalled();

    logger.setLevel('info');
    logger.info('should be logged');

    expect(infoSpy).toHaveBeenCalledWith('[WorkerManager]', 'should be logged');
  });
});
