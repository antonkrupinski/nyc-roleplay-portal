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
  const options = { projectId: process.env.FIREBASE_PROJECT_ID || "nyrp-3a5f6" };
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      const error = new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.");
      error.code = "FIREBASE_CREDENTIALS_INVALID";
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

async function getVerificationAccess(discordId) {
  const db = getFirestore();
  const id = String(discordId);
  const [memberSnapshot, linkSnapshot, requestSnapshot] = await Promise.all([
    db.collection("guildMembers").doc(id).get(),
    db.collection("robloxLinks").doc(id).get(),
    db.collection("verificationRequests").doc(id).get()
  ]);
  const member = memberSnapshot.exists ? memberSnapshot.data() : {};
  const link = linkSnapshot.exists ? linkSnapshot.data() : null;
  const request = requestSnapshot.exists ? requestSnapshot.data() : {};
  const requestStatus = typeof request.status === "string" ? request.status.toLowerCase() : "";
  const linkHasRobloxId = link && typeof link.robloxId === "string" && /^\d{1,24}$/.test(link.robloxId);
  const verifiedByRequest = ["approved", "completed", "success", "verified", "accepted"].includes(requestStatus);
  return {
    available: true,
    member: member.member === true,
    verified: member.verified === true || verifiedByRequest || Boolean(linkHasRobloxId),
    roblox: link,
    verificationPending: ["pending", "processing"].includes(requestStatus) && !Boolean(linkHasRobloxId) && member.verified !== true,
    verificationError: requestStatus === "failed" ? request.error || "verification_failed" : null
  };
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

module.exports = {
  createVerificationRequest,
  deleteProfileRecord,
  enqueueErlcVoiceCommand,
  getFirestore,
  getErlcPlaytimeMonitor,
  getProfileRecord,
  getRobloxPlaytime,
  getVerificationAccess,
  resetDepartmentRecord,
  updateDepartmentRecord,
  updateProfileRecord
};
