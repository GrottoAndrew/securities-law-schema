/**
 * Scheduler Service
 *
 * Schedules and runs periodic jobs for continuous compliance monitoring.
 * Supports cron expressions and interval-based scheduling.
 *
 * @module services/scheduler
 */

/**
 * @typedef {Object} ScheduledJob
 * @property {string} id - Unique job identifier
 * @property {string} name - Human-readable name
 * @property {string} schedule - Cron expression or interval (e.g., '0 * * * *' or '5m')
 * @property {Function} handler - Async function to execute
 * @property {boolean} enabled - Whether job is active
 * @property {string|null} lastRun - ISO timestamp of last execution
 * @property {string|null} lastResult - Result of last execution
 * @property {string|null} nextRun - ISO timestamp of next scheduled execution
 */

/**
 * Parse cron expression to get next run time.
 * Simplified implementation supporting: minute hour day month weekday
 *
 * @param {string} cron - Cron expression
 * @param {Date} from - Start time
 * @returns {Date} Next run time
 */
function getNextCronTime(cron, from = new Date()) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: ${cron}`);
  }

  const [minute, hour, day, month] = parts;

  // For simplicity, handle common patterns
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);

  // Every minute: * * * * *
  if (minute === '*' && hour === '*') {
    next.setMinutes(next.getMinutes() + 1);
    return next;
  }

  // Every hour at minute X: X * * * *
  if (hour === '*' && minute !== '*') {
    const targetMinute = parseInt(minute, 10);
    if (next.getMinutes() >= targetMinute) {
      next.setHours(next.getHours() + 1);
    }
    next.setMinutes(targetMinute);
    return next;
  }

  // Daily at specific time: M H * * *
  if (day === '*' && month === '*' && minute !== '*' && hour !== '*') {
    const targetHour = parseInt(hour, 10);
    const targetMinute = parseInt(minute, 10);

    next.setHours(targetHour);
    next.setMinutes(targetMinute);

    if (next <= from) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  // Default: add 1 hour
  next.setHours(next.getHours() + 1);
  return next;
}

/**
 * Parse interval string to milliseconds.
 *
 * @param {string} interval - Interval string (e.g., '5m', '1h', '30s')
 * @returns {number} Milliseconds
 */
function parseInterval(interval) {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid interval: ${interval}`);
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 's':
      return num * 1000;
    case 'm':
      return num * 60 * 1000;
    case 'h':
      return num * 60 * 60 * 1000;
    case 'd':
      return num * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown interval unit: ${unit}`);
  }
}

/**
 * Scheduler for running periodic compliance monitoring jobs.
 */
export class Scheduler {
  constructor() {
    /** @type {Map<string, ScheduledJob>} */
    this.jobs = new Map();

    /** @type {Map<string, NodeJS.Timeout>} */
    this.timers = new Map();

    this.running = false;
  }

  /**
   * Register a job.
   *
   * @param {Object} config
   * @param {string} config.id - Unique job identifier
   * @param {string} config.name - Human-readable name
   * @param {string} config.schedule - Cron expression or interval
   * @param {Function} config.handler - Async function to execute
   * @param {boolean} [config.enabled=true] - Whether job is active
   */
  register(config) {
    const job = {
      id: config.id,
      name: config.name,
      schedule: config.schedule,
      handler: config.handler,
      enabled: config.enabled !== false,
      lastRun: null,
      lastResult: null,
      nextRun: null,
    };

    this.jobs.set(job.id, job);

    if (this.running && job.enabled) {
      this.scheduleJob(job);
    }
  }

  /**
   * Unregister a job.
   *
   * @param {string} id
   */
  unregister(id) {
    this.cancelJob(id);
    this.jobs.delete(id);
  }

  /**
   * Enable a job.
   *
   * @param {string} id
   */
  enable(id) {
    const job = this.jobs.get(id);
    if (job) {
      job.enabled = true;
      if (this.running) {
        this.scheduleJob(job);
      }
    }
  }

  /**
   * Disable a job.
   *
   * @param {string} id
   */
  disable(id) {
    const job = this.jobs.get(id);
    if (job) {
      job.enabled = false;
      this.cancelJob(id);
    }
  }

  /**
   * Schedule a job's next execution.
   *
   * @param {ScheduledJob} job
   */
  scheduleJob(job) {
    // Cancel existing timer
    this.cancelJob(job.id);

    if (!job.enabled) return;

    let delay;

    // Check if cron or interval
    if (job.schedule.includes(' ')) {
      // Cron expression
      const nextRun = getNextCronTime(job.schedule);
      delay = nextRun.getTime() - Date.now();
      job.nextRun = nextRun.toISOString();
    } else {
      // Interval
      delay = parseInterval(job.schedule);
      job.nextRun = new Date(Date.now() + delay).toISOString();
    }

    const timer = setTimeout(async () => {
      await this.runJob(job.id);
    }, delay);

    this.timers.set(job.id, timer);
  }

  /**
   * Cancel a job's scheduled execution.
   *
   * @param {string} id
   */
  cancelJob(id) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /**
   * Run a job immediately.
   *
   * @param {string} id
   * @returns {Promise<{success: boolean, result: any, error: string|null}>}
   */
  async runJob(id) {
    const job = this.jobs.get(id);
    if (!job) {
      return { success: false, result: null, error: 'Job not found' };
    }

    job.lastRun = new Date().toISOString();

    try {
      const result = await job.handler();
      job.lastResult = 'success';

      // Reschedule if still running and enabled
      if (this.running && job.enabled) {
        this.scheduleJob(job);
      }

      return { success: true, result, error: null };
    } catch (err) {
      job.lastResult = `error: ${err.message}`;

      // Still reschedule on error
      if (this.running && job.enabled) {
        this.scheduleJob(job);
      }

      return { success: false, result: null, error: err.message };
    }
  }

  /**
   * Start the scheduler.
   */
  start() {
    if (this.running) return;

    this.running = true;

    for (const job of this.jobs.values()) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }

    console.log(`Scheduler started with ${this.jobs.size} jobs`);
  }

  /**
   * Stop the scheduler.
   */
  stop() {
    this.running = false;

    for (const id of this.timers.keys()) {
      this.cancelJob(id);
    }

    console.log('Scheduler stopped');
  }

  /**
   * Get status of all jobs.
   *
   * @returns {Object[]}
   */
  status() {
    return Array.from(this.jobs.values()).map(job => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      enabled: job.enabled,
      lastRun: job.lastRun,
      lastResult: job.lastResult,
      nextRun: job.nextRun,
    }));
  }
}

// Singleton instance
export const scheduler = new Scheduler();
