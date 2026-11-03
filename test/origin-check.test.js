const test = require("node:test");
const assert = require("node:assert/strict");
const { checkOrigin } = require("../server");

test("allows same-origin requests using the request host", () => {
  assert.equal(checkOrigin(
    { headers: { origin: "https://nyrp.lol" } },
    new URL("https://nyrp.lol/api/moderation/shift")
  ), true);
});

test("allows the public forwarded host for Vercel rewrites", () => {
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    assert.equal(checkOrigin(
      {
        headers: {
          origin: "https://nyrp.lol",
          "x-forwarded-host": "nyrp.lol, internal.vercel.app"
        }
      },
      new URL("https://internal.vercel.app/api/moderation/shift")
    ), true);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("rejects cross-origin and invalid origins", () => {
  const request = { headers: { origin: "https://attacker.example" } };
  const url = new URL("https://nyrp.lol/api/moderation/shift");
  assert.equal(checkOrigin(request, url), false);
  assert.equal(checkOrigin({ headers: { origin: "javascript:alert(1)" } }, url), false);
});
