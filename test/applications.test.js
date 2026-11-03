const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeApplicationAnswers, normalizeApplicationForm } = require("../applications");
const { handleRequest } = require("../server");

test("application forms require a title and between one and twenty valid questions", () => {
  assert.match(normalizeApplicationForm({ title: "x", questions: [] }).error, /Title/);
  assert.match(normalizeApplicationForm({ title: "Valid title", questions: [] }).error, /between 1 and 20/);
  assert.match(normalizeApplicationForm({
    title: "Valid title",
    questions: [{ text: "Question", type: "invalid" }]
  }).error, /valid response type/);

  const form = normalizeApplicationForm({
    title: "  Staff application  ",
    description: "  Tell us about yourself.  ",
    questions: [{ text: "  Why do you want to join? ", type: "long", required: false }]
  });
  assert.equal(form.title, "Staff application");
  assert.equal(form.description, "Tell us about yourself.");
  assert.equal(form.questions[0].text, "Why do you want to join?");
  assert.equal(form.questions[0].required, false);
  assert.match(form.questions[0].id, /^[0-9a-f-]{36}$/);
});

test("application answers enforce required fields, types, and answer limits", () => {
  const form = {
    questions: [
      { id: "required-short", text: "Name", type: "short", required: true },
      { id: "optional-long", text: "Details", type: "long", required: false }
    ]
  };
  assert.match(normalizeApplicationAnswers(form, { answers: {} }).error, /required/);
  assert.match(normalizeApplicationAnswers(form, { answers: { "required-short": "A".repeat(251) } }).error, /250 characters/);
  assert.match(normalizeApplicationAnswers(form, { answers: { unexpected: "answer" } }).error, /invalid question/);
  assert.deepEqual(normalizeApplicationAnswers(form, {
    answers: { "required-short": "  Alex  ", "optional-long": "" }
  }), { answers: { "required-short": "Alex", "optional-long": "" } });
});

test("application forms validate choice options and preserve all supported response types", () => {
  const form = normalizeApplicationForm({
    title: "Staff application",
    questions: [
      { text: "Department", type: "dropdown", options: ["Police", "Fire"] },
      { text: "Skills", type: "checkboxes", options: ["Writing", "Training"] },
      { text: "Experience", type: "multiple_choice", options: ["New", "Experienced"] },
      { text: "Confidence", type: "rating" },
      { text: "Resume", type: "file", required: false }
    ]
  });
  assert.equal(form.questions[0].type, "dropdown");
  assert.deepEqual(form.questions[0].options, ["Police", "Fire"]);
  assert.equal(form.questions[4].type, "file");
  assert.match(normalizeApplicationForm({
    title: "Staff application",
    questions: [{ text: "Department", type: "dropdown", options: ["Police", " police "] }]
  }).error, /unique/);
  assert.match(normalizeApplicationForm({
    title: "Staff application",
    questions: [{ text: "Department", type: "checkboxes", options: ["Only one"] }]
  }).error, /between 2 and 20/);
});

test("choice, checkbox, rating, and file answers are validated and normalized", () => {
  const form = {
    questions: [
      { id: "department", text: "Department", type: "dropdown", options: ["Police", "Fire"], required: true },
      { id: "skills", text: "Skills", type: "checkboxes", options: ["Writing", "Training"], required: true },
      { id: "confidence", text: "Confidence", type: "rating", required: true },
      { id: "resume", text: "Resume", type: "file", required: true }
    ]
  };
  const file = { name: "resume.txt", type: "text/plain", size: 3, data: Buffer.from("abc").toString("base64") };
  assert.match(normalizeApplicationAnswers(form, {
    answers: { department: "Other", skills: ["Writing"], confidence: "9", resume: file }
  }).error, /valid option/);
  assert.match(normalizeApplicationAnswers(form, {
    answers: { department: "Police", skills: ["Unknown"], confidence: "9", resume: file }
  }).error, /valid options/);
  assert.match(normalizeApplicationAnswers(form, {
    answers: { department: "Police", skills: ["Writing"], confidence: "11", resume: file }
  }).error, /rating from 1 to 10/);
  assert.match(normalizeApplicationAnswers(form, {
    answers: { department: "Police", skills: ["Writing"], confidence: "9", resume: { ...file, type: "application/x-msdownload" } }
  }).error, /PDF, DOCX/);
  const fileQuestions = Array.from({ length: 11 }, (_, index) => ({
    id: "file-" + index,
    text: "Upload " + index,
    type: "file",
    required: true
  }));
  const fileAnswers = Object.fromEntries(fileQuestions.map((question) => [question.id, file]));
  assert.match(normalizeApplicationAnswers({ questions: fileQuestions }, { answers: fileAnswers }).error, /up to 10 uploaded files/);

  const normalized = normalizeApplicationAnswers(form, {
    answers: { department: "Police", skills: ["Writing", "Training"], confidence: "9", resume: file }
  });
  assert.deepEqual(normalized.answers.skills, ["Writing", "Training"]);
  assert.deepEqual(normalized.answers.resume, file);
});

test("shared application links keep their destination through the Discord sign-in gate", async () => {
  const publicId = "Abcdefghijklmnopqrstuvwxyz012345";
  const originalDiscordConfig = {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI
  };
  process.env.DISCORD_CLIENT_ID = "test-client";
  process.env.DISCORD_CLIENT_SECRET = "test-secret";
  process.env.DISCORD_REDIRECT_URI = "https://nyrp.lol/auth/callback";
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(body) { this.body = body; }
  };

  try {
    await handleRequest({
      method: "GET",
      url: "/apply/" + publicId,
      headers: { host: "nyrp.lol" }
    }, response);
  } finally {
    for (const [key, value] of Object.entries({
      DISCORD_CLIENT_ID: originalDiscordConfig.clientId,
      DISCORD_CLIENT_SECRET: originalDiscordConfig.clientSecret,
      DISCORD_REDIRECT_URI: originalDiscordConfig.redirectUri
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes('/auth/discord?next=%2Fapply%2F' + publicId));
});

test("the management page is absent from navigation and both portal copies support application routes", () => {
  const projectRoot = path.resolve(__dirname, "..");
  for (const appDirectory of ["", "nyrp"]) {
    const appRoot = path.join(projectRoot, appDirectory);
    const html = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
    const client = fs.readFileSync(path.join(appRoot, "app.js"), "utf8");
    const server = fs.readFileSync(path.join(appRoot, "server.js"), "utf8");
    const store = fs.readFileSync(path.join(appRoot, "firestore-store.js"), "utf8");
    const styles = fs.readFileSync(path.join(appRoot, "styles.css"), "utf8");

    assert.match(html, /data-page="applications"/);
    assert.match(html, /data-page="apply"/);
    assert.doesNotMatch(html, /data-route="applications"/);
    assert.match(client, /applicationManagerAccess/);
    assert.match(client, /data-edit-application/);
    assert.match(client, /data-delete-application/);
    assert.match(client, /method: editing \? "PUT" : "POST"/);
    assert.match(client, /function showApplicationSubmitted/);
    assert.match(client, /data\.hasPendingSubmission/);
    assert.match(html, /Application Submitted/);
    assert.match(styles, /application-check-mark/);
    assert.match(styles, /body:is\(\[data-page="applications"\], \[data-page="apply"\]\) \.sidebar/);
    assert.match(styles, /body:is\(\[data-page="applications"\], \[data-page="apply"\]\) \.topbar/);
    assert.match(styles, /body:is\(\[data-page="applications"\], \[data-page="apply"\]\) \.main-area \{ margin-left: 0/);
    assert.match(server, /1567209306317791442/);
    assert.match(server, /createApplicationSubmission/);
    assert.match(server, /hasPendingSubmission/);
    assert.match(server, /managedApplicationFormMatch/);
    assert.match(server, /archiveApplicationForm/);
    assert.match(server, /updateApplicationForm/);
    assert.match(store, /reviewApplicationSubmission/);
    assert.match(store, /getPendingApplicationSubmission/);
    assert.match(store, /applicationSubmissionLocks/);
    assert.match(store, /async function archiveApplicationForm/);
    assert.match(store, /isActive: false/);
    assert.match(store, /form\.isActive !== false/);
  }

  const nestedRoot = path.join(projectRoot, "nyrp");
  assert.match(fs.readFileSync(path.join(nestedRoot, "index.html"), "utf8"), /id="confirm-modal"/);
  assert.match(fs.readFileSync(path.join(nestedRoot, "app.js"), "utf8"), /function customConfirm/);
  assert.match(fs.readFileSync(path.join(nestedRoot, "styles.css"), "utf8"), /Refined nested-portal navigation/);
});
