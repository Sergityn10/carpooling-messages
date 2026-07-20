import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.NOTIFICATIONS_URL || "http://localhost:3004";

async function _request(method, path, body, jwt) {
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }
  const options = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error || json.detail || `HTTP ${res.status}`;
    console.error(
      `[notificationsClient] ${method} ${path} → ${res.status}: ${msg}`,
    );
    return { success: false, status: res.status, error: msg, raw: json };
  }
  return json;
}

function _post(path, body) {
  return _request("POST", path, body);
}

function _get(path) {
  return _request("GET", path);
}

function _delete(path, body) {
  return _request("DELETE", path, body);
}

export const notificationsClient = {
  baseUrl: BASE_URL,

  health() {
    return _get("/health");
  },

  sendEmail({ to, subject, html, text, cc, bcc, replyTo }) {
    return _post("/api/emails/send", {
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      replyTo,
    });
  },

  sendTemplatedEmail({ to, template, data, cc, bcc, replyTo }) {
    return _post("/api/emails/send/template", {
      to,
      template,
      data,
      cc,
      bcc,
      replyTo,
    });
  },

  sendSuggestion({
    companyName,
    companyEmail,
    userName,
    userEmail,
    suggestionId,
    website,
  }) {
    return _post("/api/emails/send/suggestion", {
      companyName,
      companyEmail,
      userName,
      userEmail,
      suggestionId,
      website,
    });
  },

  sendBatchEmails(emails) {
    return _post("/api/emails/send/batch", { emails });
  },

  listEmailTemplates() {
    return _get("/api/emails/templates");
  },

  checkSmtpHealth() {
    return _get("/api/emails/health/smtp");
  },

  sendPushToToken({ token, title, body, data, priority, channelId, badge }) {
    return _post("/api/push/send", {
      token,
      title,
      body,
      data,
      priority,
      channelId,
      badge,
    });
  },

  sendPushMulticast({ tokens, title, body, data, priority, channelId, badge }) {
    return _post("/api/push/send/multicast", {
      tokens,
      title,
      body,
      data,
      priority,
      channelId,
      badge,
    });
  },

  sendPushToUser({ userId, title, body, data, priority, channelId, badge }) {
    return _post("/api/push/send/user", {
      userId,
      title,
      body,
      data,
      priority,
      channelId,
      badge,
    });
  },

  sendPushToTopic({ topic, title, body, data, priority }) {
    return _post("/api/push/send/topic", {
      topic,
      title,
      body,
      data,
      priority,
    });
  },

  sendPushTemplateToUser({
    userId,
    template,
    data,
    priority,
    channelId,
    badge,
  }) {
    return _post("/api/push/send/template/user", {
      userId,
      template,
      data,
      priority,
      channelId,
      badge,
    });
  },

  subscribeToTopic({ tokens, topic }) {
    return _post("/api/push/topic/subscribe", { tokens, topic });
  },

  unsubscribeFromTopic({ tokens, topic }) {
    return _post("/api/push/topic/unsubscribe", { tokens, topic });
  },

  registerDeviceToken(jwt, { token, platform, deviceId, deviceName }) {
    return _request(
      "POST",
      "/api/device-tokens",
      { token, platform, deviceId, deviceName },
      jwt,
    );
  },

  listMyDevices(jwt) {
    return _request("GET", "/api/device-tokens/me", undefined, jwt);
  },

  listAllDevices(jwt) {
    return _request("GET", "/api/device-tokens/admin/all", undefined, jwt);
  },

  listDevicesByUser(jwt, userId) {
    return _request(
      "GET",
      `/api/device-tokens/admin/user/${userId}`,
      undefined,
      jwt,
    );
  },

  deleteDeviceToken(jwt, { token, deviceId }) {
    return _request("DELETE", "/api/device-tokens", { token, deviceId }, jwt);
  },
};

export default notificationsClient;
