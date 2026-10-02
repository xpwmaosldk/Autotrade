// Web Worker for Native Foreground Service Trading Loop
// Runs off the main DOM thread to prevent browser background throttling
// Utilizes drift-compensating recursive timers + backup interval

let timeoutId = null;
let backupIntervalId = null;
let isRunning = false;
let intervalMs = 5000;
let expectedTime = 0;
let tickCount = 0;

function scheduleNextTick() {
  if (!isRunning) return;
  const now = Date.now();
  const drift = now - expectedTime;
  expectedTime += intervalMs;
  const nextDelay = Math.max(100, intervalMs - drift);

  timeoutId = setTimeout(() => {
    if (!isRunning) return;
    tickCount++;
    self.postMessage({
      type: 'TICK',
      timestamp: Date.now(),
      tickCount,
      drift,
      source: 'drift_timeout'
    });
    scheduleNextTick();
  }, nextDelay);
}

self.addEventListener('message', (e) => {
  const { action, payload } = e.data || {};

  if (action === 'start') {
    intervalMs = (payload && payload.intervalSeconds ? payload.intervalSeconds : 5) * 1000;
    isRunning = true;
    tickCount = 0;

    if (timeoutId) clearTimeout(timeoutId);
    if (backupIntervalId) clearInterval(backupIntervalId);

    // Immediate initial tick
    expectedTime = Date.now() + intervalMs;
    self.postMessage({ type: 'TICK', timestamp: Date.now(), tickCount: 0, source: 'initial' });

    scheduleNextTick();

    // Secondary backup interval in case browser attempts to throttle setTimeout
    backupIntervalId = setInterval(() => {
      if (!isRunning) return;
      const now = Date.now();
      // If no tick has occurred within 1.8x interval, fire backup tick
      if (now - (expectedTime - intervalMs) > intervalMs * 1.8) {
        tickCount++;
        self.postMessage({
          type: 'TICK',
          timestamp: now,
          tickCount,
          source: 'backup_interval'
        });
        expectedTime = now + intervalMs;
      }
    }, intervalMs);

    self.postMessage({ type: 'STATUS', status: 'started', intervalMs });
  } else if (action === 'stop') {
    isRunning = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (backupIntervalId) {
      clearInterval(backupIntervalId);
      backupIntervalId = null;
    }
    self.postMessage({ type: 'STATUS', status: 'stopped' });
  } else if (action === 'ping') {
    self.postMessage({ type: 'PONG', timestamp: Date.now(), isRunning, tickCount });
  }
});
