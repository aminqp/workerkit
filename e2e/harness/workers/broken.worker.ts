/**
 * A bundled worker whose module throws while loading — the situation when a
 * bundled dependency fails to initialise. It never registers a message
 * listener, so any message sent to it goes unanswered.
 */
throw new Error('broken.worker failed to initialise');
