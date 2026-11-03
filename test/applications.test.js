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

    assert.match(html, /data-page="applications"/);
    assert.match(html, /data-page="apply"/);
    assert.doesNotMatch(html, /data-route="applications"/);
    assert.match(client, /applicationManagerAccess/);
    assert.match(server, /1567209306317791442/);
    assert.match(server, /createApplicationSubmission/);
    assert.match(store, /reviewApplicationSubmission/);
  }
});
