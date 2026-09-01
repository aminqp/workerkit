import { describe, it, expect, vi } from 'vitest';
import defaultInitiator from './initiator';

describe('defaultInitiator', () => {
  it('adds a message listener and posts data back', () => {
    const postMessageSpy = vi.fn();
    const addEventListenerSpy = vi.fn();

    vi.stubGlobal('self', {
      postMessage: postMessageSpy,
      addEventListener: addEventListenerSpy,
    });

    defaultInitiator();

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'message',
      expect.any(Function),
    );

    // Simulate receiving a message
    const messageHandler = addEventListenerSpy.mock.calls[0][1];
    const mockEvent = { data: { testData: 123 } };
    messageHandler(mockEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({ testData: 123 });

    vi.unstubAllGlobals();
  });
});
