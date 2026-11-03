const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

let firestore;

function hasDefaultCredentials() {
  const candidate = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (candidate && fs.existsSync(candidate)) return true;
  const configDir = process.env.CLOUDSDK_CONFIG || path.join(os.homedir(), ".config", "gcloud");
  if (fs.existsSync(path.join(configDir, "application_default_credentials.json"))) return true;
  return Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.GAE_ENV || process.env.GCE_METADATA_HOST);
}

function getFirestore() {
  if (firestore) return firestore;

  const { applicationDefault, cert, initializeApp } = require("firebase-admin/app");
  const { getFirestore: createFirestore } = require("firebase-admin/firestore");
  const projectId = process.env.FIREBASE_PROJECT_ID || "nyrp-3a5f6";
  const options = { projectId };
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
      error.code = "FIREBASE_CREDENTIALS_INVALID";
      throw error;
    }
    if (serviceAccount.project_id && serviceAccount.project_id !== projectId) {
      const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON belongs to a different project than FIREBASE_PROJECT_ID.");
      error.code = "FIREBASE_PROJECT_MISMATCH";
      throw error;
    }
    options.credential = cert(serviceAccount);
  } else {
    if (!hasDefaultCredentials()) {
      const error = new Error("Firebase server credentials are missing. Set GOOGLE_APPLICATION_CREDENTIALS or use Application Default Credentials.");
      error.code = "FIREBASE_CREDENTIALS_MISSING";
      throw error;
    }
    options.credential = applicationDefault();
  }

  const app = initializeApp(options, "nyc-roleplay-portal");
  firestore = createFirestore(app);
  return firestore;
}

async function getVerificationAccess(discordId, encryptionSecret) {
  const db = getFirestore();
  const id = String(discordId);
  const [memberSnapshot, linkSnapshot, requestSnapshot, oauthSnapshot] = await Promise.all([
    db.collection("guildMembers").doc(id).get(),
    db.collection("robloxLinks").doc(id).get(),
    db.collection("verificationRequests").doc(id).get(),
    db.collection("discordOAuthTokens").doc(id).get()
  ]);
  const member = memberSnapshot.exists ? memberSnapshot.data() : {};
  const link = linkSnapshot.exists ? linkSnapshot.data() : null;
  const request = requestSnapshot.exists ? requestSnapshot.data() : {};
  const rawRoles = member.roleIds ?? member.roles ?? member.discordRoles ?? [];
  const roleIds = (Array.isArray(rawRoles) ? rawRoles : rawRoles && typeof rawRoles === "object" ? Object.keys(rawRoles).filter((roleId) => rawRoles[roleId]) : [])
    .map((role) => typeof role === "string" ? role : role && typeof role.id === "string" ? role.id : "")
    .filter((roleId) => /^\d{17,20}$/.test(roleId));
  const requestStatus = typeof request.status === "string" ? request.status.toLowerCase() : "";
  const linkHasRobloxId = link && typeof link.robloxId === "string" && /^\d{1,24}$/.test(link.robloxId);
  const verifiedByRequest = ["approved", "completed", "success", "verified", "accepted"].includes(requestStatus);
  const discordOAuthTokens = oauthSnapshot.exists
    ? decryptDiscordOAuthTokens(oauthSnapshot.data(), encryptionSecret)
    : null;
  return {
    available: true,
    member: member.member === true,
    guildId: typeof member.guildId === "string" ? member.guildId : "",
    roleIds,
    discordOAuthTokens,
    verified: member.verified === true || verifiedByRequest || Boolean(linkHasRobloxId),
    roblox: link,
    verificationPending: ["pending", "processing"].includes(requestStatus) && !Boolean(linkHasRobloxId) && member.verified !== true,
    verificationError: requestStatus === "failed" ? request.error || "verification_failed" : null
  };
}

function discordOAuthEncryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("A stable session secret is required to encrypt Discord OAuth tokens.");
  }
  return crypto.createHash("sha256").update("nyrp-discord-oauth\0").update(secret).digest();
}

function encryptDiscordOAuthTokens(tokens, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", discordOAuthEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
}

function decryptDiscordOAuthTokens(record, secret) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    discordOAuthEncryptionKey(secret),
    Buffer.from(record.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

async function saveDiscordOAuthTokens(discordId, tokens, secret) {
  const encrypted = encryptDiscordOAuthTokens(tokens, secret);
  await getFirestore().collection("discordOAuthTokens").doc(String(discordId)).set({
    ...encrypted,
    updatedAt: new Date().toISOString()
  });
}

async function deleteDiscordOAuthTokens(discordId) {
  await getFirestore().collection("discordOAuthTokens").doc(String(discordId)).delete();
}

async function saveGuildMemberRoleIds(discordId, roleIds) {
  await getFirestore().collection("guildMembers").doc(String(discordId)).set({
    roleIds: Array.from(new Set(roleIds.filter((roleId) => /^\d{17,20}$/.test(roleId)))),
    roleIdsUpdatedAt: new Date().toISOString()
  }, { merge: true });
}

async function getRobloxPlaytime(robloxId) {
  const snapshot = await getFirestore().collection("erlcPlaytime").doc(String(robloxId)).get();
  if (!snapshot.exists) return { robloxId: String(robloxId), totalSeconds: 0, lastSeenAt: null };
  const record = snapshot.data();
  return {
    robloxId: String(robloxId),
    totalSeconds: Math.max(0, Math.floor(Number(record.totalSeconds) || 0)),
    lastSeenAt: typeof record.lastSeenAt === "string" ? record.lastSeenAt : null
  };
}

async function getErlcPlaytimeMonitor() {
  const snapshot = await getFirestore().collection("botState").doc("erlcPlaytimeMonitor").get();
  return snapshot.exists ? snapshot.data() : { lastSuccessfulPollAt: null };
}

async function createVerificationRequest(discordId, roblox) {
  const id = String(discordId);
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const request = {
    requestId,
    discordId: id,
    robloxId: String(roblox.robloxId),
    robloxUsername: String(roblox.robloxUsername),
    status: "pending",
    error: null,
    createdAt: now,
    updatedAt: now
  };
  await getFirestore().collection("verificationRequests").doc(id).set(request);
  return request;
}

async function enqueueErlcVoiceCommand(eventId, command) {
  if (!/^[a-f0-9]{64}$/.test(String(eventId))) throw new Error("Invalid ER:LC voice command event ID.");
  if (!command || !["staff", "scene", "traffic"].includes(command.command)) throw new Error("Invalid ER:LC voice command.");
  const radiusStuds = command.radiusStuds == null ? null : Number(command.radiusStuds);
  if (radiusStuds !== null && (!Number.isFinite(radiusStuds) || radiusStuds < 1 || radiusStuds > 10_000)) {
    throw new Error("Invalid ER:LC voice command radius.");
  }
  const ref = getFirestore().collection("erlcVoiceCommands").doc(eventId);
  try {
    await ref.create({
      command: command.command,
      radiusStuds,
      playerName: String(command.playerName || "").slice(0, 64),
      robloxId: /^\d{1,24}$/.test(String(command.robloxId || "")) ? String(command.robloxId) : null,
      status: "pending",
      createdAt: new Date().toISOString(),
      processingAt: null,
      completedAt: null,
      result: null
    });
    return true;
  } catch (error) {
    if (error.code === 6 || error.code === "already-exists") return false;
    throw error;
  }
}

async function getProfileRecord(discordId, fallback, readLegacy) {
  const db = getFirestore();
  const ref = db.collection("profiles").doc(String(discordId));
  const tombstoneRef = db.collection("profileTombstones").doc(String(discordId));
  return db.runTransaction(async (transaction) => {
    const [snapshot, tombstone] = await Promise.all([transaction.get(ref), transaction.get(tombstoneRef)]);
    if (snapshot.exists) return snapshot.data();
    if (tombstone.exists) return fallback();
    const legacy = await readLegacy();
    const record = legacy?.[discordId] || fallback();
    transaction.set(ref, record);
    return record;
  });
}

async function updateProfileRecord(discordId, fallback, update, readLegacy) {
  const db = getFirestore();
  const ref = db.collection("profiles").doc(String(discordId));
  const tombstoneRef = db.collection("profileTombstones").doc(String(discordId));
  return db.runTransaction(async (transaction) => {
    const [snapshot, tombstone] = await Promise.all([transaction.get(ref), transaction.get(tombstoneRef)]);
    const legacy = snapshot.exists || tombstone.exists ? null : await readLegacy();
    const current = snapshot.exists ? snapshot.data() : tombstone.exists ? fallback() : legacy?.[discordId] || fallback();
    const outcome = update(current);
    if (outcome?.record) {
      transaction.set(ref, outcome.record);
      transaction.delete(tombstoneRef);
    }
    return outcome;
  });
}

async function deleteProfileRecord(discordId) {
  const db = getFirestore();
  const ref = db.collection("profiles").doc(String(discordId));
  const tombstoneRef = db.collection("profileTombstones").doc(String(discordId));
  await db.runTransaction(async (transaction) => {
    transaction.delete(ref);
    transaction.set(tombstoneRef, { deletedAt: new Date().toISOString() });
  });
}

async function updateDepartmentRecord(fallback, readLegacy, operation) {
  const db = getFirestore();
  const ref = db.collection("appData").doc("departments");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const legacy = snapshot.exists ? null : await readLegacy();
    const state = snapshot.exists ? snapshot.data() : legacy || fallback();
    const result = await operation(state);
    transaction.set(ref, state);
    return result;
  });
}

async function resetDepartmentRecord(fallback, readLegacy, reset) {
  const db = getFirestore();
  const ref = db.collection("appData").doc("departments");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const legacy = snapshot.exists ? null : await readLegacy();
    const state = snapshot.exists ? snapshot.data() : legacy || fallback();
    const changed = reset(state);
    if (changed || !snapshot.exists) transaction.set(ref, state);
    return changed;
  });
}

async function getModerationShift(discordId) {
  const snapshot = await getFirestore().collection("moderationShifts").doc(String(discordId)).get();
  if (!snapshot.exists) return { totalMinutes: 0, activeShift: null, shiftHistory: [] };
  const record = snapshot.data();
  return {
    totalMinutes: Math.max(0, Math.floor(Number(record.totalMinutes) || 0)),
    activeShift: record.activeShift?.startedAt ? record.activeShift : null,
    shiftHistory: Array.isArray(record.shiftHistory) ? record.shiftHistory.slice(-20) : []
  };
}

async function updateModerationShift(discordId, update) {
  const ref = getFirestore().collection("moderationShifts").doc(String(discordId));
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : { totalMinutes: 0, activeShift: null, shiftHistory: [] };
    const result = update({
      totalMinutes: Math.max(0, Math.floor(Number(current.totalMinutes) || 0)),
      activeShift: current.activeShift?.startedAt ? current.activeShift : null,
      shiftHistory: Array.isArray(current.shiftHistory) ? current.shiftHistory.slice(-20) : []
    });
    if (result.record) transaction.set(ref, result.record);
    return result;
  });
}

async function getModerationLogs(robloxId) {
  const snapshot = await getFirestore()
    .collection("moderationLogs")
    .doc(String(robloxId))
    .collection("entries")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function createModerationLog(robloxId, entry) {
  const id = crypto.randomUUID();
  await getFirestore()
    .collection("moderationLogs")
    .doc(String(robloxId))
    .collection("entries")
    .doc(id)
    .set(entry);
  return { id, ...entry };
}

async function updateModerationLog(robloxId, logId, updates) {
  await getFirestore()
    .collection("moderationLogs")
    .doc(String(robloxId))
    .collection("entries")
    .doc(String(logId))
    .set(updates, { merge: true });
}

async function createApplicationForm(form) {
  const db = getFirestore();
  const id = crypto.randomUUID();
  const record = {
    ...form,
    publicId: crypto.randomBytes(24).toString("base64url"),
    isActive: true,
    createdAt: new Date().toISOString()
  };
  await db.collection("applicationForms").doc(id).set(record);
  return { id, ...record };
}

async function getApplicationForms() {
  const snapshot = await getFirestore().collection("applicationForms").orderBy("createdAt", "desc").limit(100).get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((form) => form.isActive !== false);
}

async function updateApplicationForm(id, form) {
  const ref = getFirestore().collection("applicationForms").doc(String(id));
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("isActive") === false) return null;
    const updates = {
      title: form.title,
      description: form.description,
      questions: form.questions,
      updatedAt: new Date().toISOString()
    };
    transaction.update(ref, updates);
    return { id: snapshot.id, ...snapshot.data(), ...updates };
  });
}

async function archiveApplicationForm(id) {
  const ref = getFirestore().collection("applicationForms").doc(String(id));
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("isActive") === false) return false;
    transaction.update(ref, { isActive: false, deletedAt: new Date().toISOString() });
    return true;
  });
}

async function getPublicApplicationForm(publicId) {
  const snapshot = await getFirestore().collection("applicationForms").where("publicId", "==", String(publicId)).limit(1).get();
  if (snapshot.empty) return null;
  const document = snapshot.docs[0];
  const form = { id: document.id, ...document.data() };
  return form.isActive === false ? null : form;
}

async function createApplicationSubmission(form, applicant, answers) {
  const db = getFirestore();
  const submissions = db.collection("applicationSubmissions");
  const lockRef = db.collection("applicationSubmissionLocks").doc(form.id + "_" + applicant.discordId);
  const legacyRef = submissions.doc(form.id + "_" + applicant.discordId);
  return db.runTransaction(async (transaction) => {
    const [formSnapshot, lockSnapshot, legacySnapshot] = await Promise.all([
      transaction.get(db.collection("applicationForms").doc(form.id)),
      transaction.get(lockRef),
      transaction.get(legacyRef)
    ]);
    if (!formSnapshot.exists || formSnapshot.get("publicId") !== form.publicId || formSnapshot.get("isActive") === false) return { error: "application_unavailable" };
    if (lockSnapshot.exists && lockSnapshot.get("submissionId")) {
      const activeId = String(lockSnapshot.get("submissionId"));
      const activeSnapshot = activeId === legacyRef.id ? legacySnapshot : await transaction.get(submissions.doc(activeId));
      if (activeSnapshot.exists && activeSnapshot.get("status") === "pending") return { error: "already_applied" };
    }
    if (legacySnapshot.exists && legacySnapshot.get("status") === "pending") return { error: "already_applied" };
    const id = crypto.randomUUID();
    const ref = submissions.doc(id);
    const submission = {
      formId: form.id,
      formTitle: form.title,
      questions: form.questions,
      answers,
      applicant,
      status: "pending",
      notificationStatus: "pending",
      createdAt: new Date().toISOString()
    };
    transaction.create(ref, submission);
    transaction.set(lockRef, { submissionId: id, formId: form.id, discordId: String(applicant.discordId) });
    return { id, ...submission };
  });
}

async function getPendingApplicationSubmission(formId, discordId) {
  const db = getFirestore();
  const submissions = db.collection("applicationSubmissions");
  const legacyRef = submissions.doc(String(formId) + "_" + String(discordId));
  const lockRef = db.collection("applicationSubmissionLocks").doc(String(formId) + "_" + String(discordId));
  const lockSnapshot = await lockRef.get();
  if (lockSnapshot.exists && lockSnapshot.get("submissionId")) {
    const activeId = String(lockSnapshot.get("submissionId"));
    const activeRef = activeId === legacyRef.id ? legacyRef : submissions.doc(activeId);
    const activeSnapshot = await activeRef.get();
    if (activeSnapshot.exists && activeSnapshot.get("status") === "pending") {
      return { id: activeSnapshot.id, ...activeSnapshot.data() };
    }
  }
  const legacySnapshot = await legacyRef.get();
  return legacySnapshot.exists && legacySnapshot.get("status") === "pending"
    ? { id: legacySnapshot.id, ...legacySnapshot.data() }
    : null;
}

async function getApplicationSubmission(id) {
  const snapshot = await getFirestore().collection("applicationSubmissions").doc(String(id)).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function listPendingApplicationNotifications() {
  const snapshot = await getFirestore().collection("applicationSubmissions")
    .where("notificationStatus", "==", "pending")
    .limit(25)
    .get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function claimApplicationNotification(id) {
  const ref = getFirestore().collection("applicationSubmissions").doc(String(id));
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const submission = snapshot.data();
    const stale = submission.notificationStatus === "sending" &&
      Date.now() - Date.parse(submission.notificationStartedAt || "") > 60_000;
    if (submission.status !== "pending" || (submission.notificationStatus !== "pending" && !stale)) return null;
    const notificationStartedAt = new Date().toISOString();
    transaction.update(ref, { notificationStatus: "sending", notificationStartedAt });
    return { id: snapshot.id, ...submission, notificationStartedAt };
  });
}

async function completeApplicationNotification(id, outcome) {
  const ref = getFirestore().collection("applicationSubmissions").doc(String(id));
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("notificationStatus") !== "sending") return false;
    transaction.update(ref, outcome.status === "sent"
      ? {
          notificationStatus: "sent",
          discordChannelId: String(outcome.channelId),
          discordMessageId: String(outcome.messageId),
          notificationError: null
        }
      : { notificationStatus: "pending", notificationError: String(outcome.error || "Discord notification failed").slice(0, 500) });
    return true;
  });
}

async function reviewApplicationSubmission(id, outcome) {
  const db = getFirestore();
  const ref = db.collection("applicationSubmissions").doc(String(id));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("status") !== "pending") return null;
    const submission = snapshot.data();
    const lockRef = db.collection("applicationSubmissionLocks").doc(`${submission.formId}_${submission.applicant.discordId}`);
    const lockSnapshot = await transaction.get(lockRef);
    const reviewed = {
      status: outcome.status,
      reviewReason: String(outcome.reason),
      reviewerDiscordId: String(outcome.reviewerDiscordId),
      reviewedAt: new Date().toISOString()
    };
    transaction.update(ref, reviewed);
    if (lockSnapshot.exists && lockSnapshot.get("submissionId") === snapshot.id) transaction.delete(lockRef);
    return { id: snapshot.id, ...submission, ...reviewed };
  });
}

module.exports = {
  createVerificationRequest,
  archiveApplicationForm,
  createApplicationForm,
  createApplicationSubmission,
  createModerationLog,
  deleteProfileRecord,
  enqueueErlcVoiceCommand,
  getApplicationForms,
  updateApplicationForm,
  getApplicationSubmission,
  getPendingApplicationSubmission,
  getFirestore,
  getPublicApplicationForm,
  getModerationLogs,
  getModerationShift,
  getErlcPlaytimeMonitor,
  getProfileRecord,
  listPendingApplicationNotifications,
  claimApplicationNotification,
  completeApplicationNotification,
  reviewApplicationSubmission,
  getRobloxPlaytime,
  getVerificationAccess,
  saveDiscordOAuthTokens,
  deleteDiscordOAuthTokens,
  saveGuildMemberRoleIds,
  resetDepartmentRecord,
  updateModerationLog,
  updateModerationShift,
  updateDepartmentRecord,
  updateProfileRecord
};
