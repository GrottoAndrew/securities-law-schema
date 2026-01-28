/**
 * Gap Detection Service
 *
 * Detects missing evidence for compliance controls and triggers alerts.
 * Runs continuously to ensure compliance coverage.
 *
 * @module services/gap-detection
 */

import config from '../config/index.js';

/**
 * @typedef {Object} ControlGap
 * @property {string} controlId - Control identifier
 * @property {string} controlTitle - Control title
 * @property {string} gapType - Type of gap (missing, stale, insufficient)
 * @property {string} severity - Gap severity (critical, high, medium, low)
 * @property {string} message - Human-readable description
 * @property {number} daysSinceLastEvidence - Days since last evidence (if any)
 * @property {number} evidenceCount - Current evidence count
 * @property {number} requiredCount - Minimum required evidence count
 * @property {string} detectedAt - ISO timestamp
 */

/**
 * @typedef {Object} GapDetectionConfig
 * @property {number} [staleDays] - Days after which evidence is considered stale
 * @property {number} [criticalDays] - Days without evidence before critical alert
 * @property {Object.<string, number>} [minimumEvidence] - Minimum evidence per control
 * @property {string[]} [criticalControls] - Controls that must always have evidence
 */

const DEFAULT_CONFIG = {
  staleDays: 30,
  criticalDays: 90,
  minimumEvidence: {}, // controlId -> minimum count
  criticalControls: [], // controls that trigger critical alerts if missing
};

/**
 * Gap Detection Engine
 */
export class GapDetector {
  /**
   * @param {GapDetectionConfig} detectionConfig
   */
  constructor(detectionConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...detectionConfig };
    this.lastScan = null;
    this.lastGaps = [];

    // Notification function (set by application)
    this.notify = null;
  }

  /**
   * Set notification callback.
   *
   * @param {Function} notifyFn - Async function(subject, message, severity)
   */
  setNotificationHandler(notifyFn) {
    this.notify = notifyFn;
  }

  /**
   * Detect gaps in evidence coverage.
   *
   * @param {Object[]} controls - All controls
   * @param {Object.<string, {count: number, lastEvidence: string}>} evidenceByControl - Evidence summary
   * @returns {ControlGap[]}
   */
  detect(controls, evidenceByControl) {
    const gaps = [];
    const now = new Date();

    for (const control of controls) {
      const evidence = evidenceByControl[control.id] || { count: 0, lastEvidence: null };
      const requiredCount = this.config.minimumEvidence[control.id] || 1;
      const isCritical = this.config.criticalControls.includes(control.id);

      // Calculate days since last evidence
      let daysSinceEvidence = null;
      if (evidence.lastEvidence) {
        const lastDate = new Date(evidence.lastEvidence);
        daysSinceEvidence = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Check for missing evidence (no evidence at all)
      if (evidence.count === 0) {
        gaps.push({
          controlId: control.id,
          controlTitle: control.title,
          gapType: 'missing',
          severity: isCritical ? 'critical' : 'high',
          message: `No evidence collected for control: ${control.title}`,
          daysSinceLastEvidence: daysSinceEvidence,
          evidenceCount: 0,
          requiredCount,
          detectedAt: now.toISOString(),
        });
        continue;
      }

      // Check for insufficient evidence
      if (evidence.count < requiredCount) {
        gaps.push({
          controlId: control.id,
          controlTitle: control.title,
          gapType: 'insufficient',
          severity: isCritical ? 'high' : 'medium',
          message: `Insufficient evidence for control: ${control.title} (${evidence.count}/${requiredCount})`,
          daysSinceLastEvidence: daysSinceEvidence,
          evidenceCount: evidence.count,
          requiredCount,
          detectedAt: now.toISOString(),
        });
        continue;
      }

      // Check for stale evidence
      if (daysSinceEvidence !== null) {
        if (daysSinceEvidence >= this.config.criticalDays) {
          gaps.push({
            controlId: control.id,
            controlTitle: control.title,
            gapType: 'stale',
            severity: 'critical',
            message: `Evidence critically stale for control: ${control.title} (${daysSinceEvidence} days old)`,
            daysSinceLastEvidence: daysSinceEvidence,
            evidenceCount: evidence.count,
            requiredCount,
            detectedAt: now.toISOString(),
          });
        } else if (daysSinceEvidence >= this.config.staleDays) {
          gaps.push({
            controlId: control.id,
            controlTitle: control.title,
            gapType: 'stale',
            severity: isCritical ? 'high' : 'medium',
            message: `Evidence stale for control: ${control.title} (${daysSinceEvidence} days old)`,
            daysSinceLastEvidence: daysSinceEvidence,
            evidenceCount: evidence.count,
            requiredCount,
            detectedAt: now.toISOString(),
          });
        }
      }
    }

    this.lastScan = now.toISOString();
    this.lastGaps = gaps;

    return gaps;
  }

  /**
   * Run detection and send alerts for new/changed gaps.
   *
   * @param {Object[]} controls - All controls
   * @param {Object.<string, {count: number, lastEvidence: string}>} evidenceByControl - Evidence summary
   * @returns {Promise<{gaps: ControlGap[], alertsSent: number}>}
   */
  async detectAndAlert(controls, evidenceByControl) {
    const previousGaps = new Set(this.lastGaps.map(g => `${g.controlId}:${g.gapType}`));
    const gaps = this.detect(controls, evidenceByControl);

    let alertsSent = 0;

    if (!this.notify) {
      return { gaps, alertsSent };
    }

    // Group gaps by severity for batched alerts
    const critical = gaps.filter(g => g.severity === 'critical');
    const high = gaps.filter(g => g.severity === 'high');
    const medium = gaps.filter(g => g.severity === 'medium');

    // Send critical alerts immediately
    for (const gap of critical) {
      const isNew = !previousGaps.has(`${gap.controlId}:${gap.gapType}`);
      if (isNew) {
        await this.notify(
          `CRITICAL: ${gap.gapType.toUpperCase()} Evidence - ${gap.controlTitle}`,
          gap.message,
          'critical'
        );
        alertsSent++;
      }
    }

    // Send high alerts if any
    if (high.length > 0) {
      const newHigh = high.filter(g => !previousGaps.has(`${g.controlId}:${g.gapType}`));
      if (newHigh.length > 0) {
        const summary = newHigh.map(g => `- ${g.controlTitle}: ${g.message}`).join('\n');
        await this.notify(`HIGH: ${newHigh.length} Evidence Gap(s) Detected`, summary, 'high');
        alertsSent++;
      }
    }

    // Send medium alerts as daily digest (only if new)
    if (medium.length > 0) {
      const newMedium = medium.filter(g => !previousGaps.has(`${g.controlId}:${g.gapType}`));
      if (newMedium.length > 0) {
        const summary = newMedium.map(g => `- ${g.controlTitle}: ${g.message}`).join('\n');
        await this.notify(
          `MEDIUM: ${newMedium.length} Evidence Gap(s) Detected`,
          summary,
          'medium'
        );
        alertsSent++;
      }
    }

    return { gaps, alertsSent };
  }

  /**
   * Get summary report of current gaps.
   *
   * @returns {Object}
   */
  getSummary() {
    const gaps = this.lastGaps;

    return {
      lastScan: this.lastScan,
      totalGaps: gaps.length,
      bySeverity: {
        critical: gaps.filter(g => g.severity === 'critical').length,
        high: gaps.filter(g => g.severity === 'high').length,
        medium: gaps.filter(g => g.severity === 'medium').length,
        low: gaps.filter(g => g.severity === 'low').length,
      },
      byType: {
        missing: gaps.filter(g => g.gapType === 'missing').length,
        stale: gaps.filter(g => g.gapType === 'stale').length,
        insufficient: gaps.filter(g => g.gapType === 'insufficient').length,
      },
      gaps,
    };
  }

  /**
   * Update configuration.
   *
   * @param {Partial<GapDetectionConfig>} updates
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Set minimum evidence requirement for a control.
   *
   * @param {string} controlId
   * @param {number} minimum
   */
  setMinimumEvidence(controlId, minimum) {
    this.config.minimumEvidence[controlId] = minimum;
  }

  /**
   * Mark a control as critical (always requires evidence).
   *
   * @param {string} controlId
   */
  markCritical(controlId) {
    if (!this.config.criticalControls.includes(controlId)) {
      this.config.criticalControls.push(controlId);
    }
  }

  /**
   * Unmark a control as critical.
   *
   * @param {string} controlId
   */
  unmarkCritical(controlId) {
    this.config.criticalControls = this.config.criticalControls.filter(id => id !== controlId);
  }
}

/**
 * Create notification handler using the database notification system.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether notifications are enabled
 * @param {string} options.email - Email address
 * @param {string} options.slackWebhook - Slack webhook URL
 * @param {string} options.teamsWebhook - Teams webhook URL
 * @returns {Function}
 */
export function createNotificationHandler(options) {
  return async (subject, message, severity) => {
    if (!options.enabled) return;

    const timestamp = new Date().toISOString();
    const fullMessage = `[${severity.toUpperCase()}] ${message}\n\nDetected: ${timestamp}`;

    // Slack
    if (options.slackWebhook) {
      const emoji =
        severity === 'critical'
          ? ':rotating_light:'
          : severity === 'high'
            ? ':warning:'
            : ':information_source:';
      try {
        await fetch(options.slackWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${emoji} *${subject}*\n${fullMessage}`,
          }),
        });
      } catch (err) {
        console.error('Failed to send Slack alert:', err.message);
      }
    }

    // Teams
    if (options.teamsWebhook) {
      const color = severity === 'critical' ? 'FF0000' : severity === 'high' ? 'FFA500' : '0078D7';
      try {
        await fetch(options.teamsWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            '@type': 'MessageCard',
            themeColor: color,
            summary: subject,
            sections: [
              {
                activityTitle: subject,
                text: fullMessage,
                facts: [
                  { name: 'Severity', value: severity.toUpperCase() },
                  { name: 'Timestamp', value: timestamp },
                ],
              },
            ],
          }),
        });
      } catch (err) {
        console.error('Failed to send Teams alert:', err.message);
      }
    }

    // Email (logged for external processing)
    if (options.email) {
      console.error(
        `[COMPLIANCE ALERT] To: ${options.email} Subject: ${subject} Severity: ${severity}\n${fullMessage}`
      );
    }
  };
}

// Singleton instance with default config
export const gapDetector = new GapDetector({
  staleDays: parseInt(process.env.EVIDENCE_STALE_DAYS, 10) || 30,
  criticalDays: parseInt(process.env.EVIDENCE_CRITICAL_DAYS, 10) || 90,
});

// Set notification handler from config
if (config.notifications) {
  gapDetector.setNotificationHandler(
    createNotificationHandler({
      enabled: config.notifications.enabled,
      email: config.notifications.email,
      slackWebhook: config.notifications.slackWebhook,
      teamsWebhook: config.notifications.teamsWebhook,
    })
  );
}
