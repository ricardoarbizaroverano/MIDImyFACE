// Actual notification delivery must run from trusted backend code only.
// The public browser must never enumerate subscribed users or send email.

async function notifyInstallationOnline({ notificationId, sessionId, startedAt }) {
  void notificationId;
  void sessionId;
  void startedAt;
  return {
    enabled: false,
    queued: 0,
  };
}

module.exports = {
  notifyInstallationOnline,
};