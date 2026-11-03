const test = require("node:test");
const assert = require("node:assert/strict");
const { searchRobloxUsers } = require("../server");

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("uses Roblox keyword search for moderation autocomplete", async () => {
  global.fetch = async (url) => {
    assert.match(String(url), /users\.roblox\.com\/v1\/users\/search\?/);
    return {
      ok: true,
      json: async () => ({
        data: [{ id: 12345, name: "TestPlayer", displayName: "Test Player", hasVerifiedBadge: false }]
      })
    };
  };

  const users = await searchRobloxUsers("unique-search-" + Date.now());
  assert.deepEqual(users, [{
    id: "12345",
    username: "TestPlayer",
    displayName: "Test Player",
    hasVerifiedBadge: false
  }]);
});

test("falls back to Roblox username lookup when keyword search is unavailable", async () => {
  let calls = 0;
  global.fetch = async (url, options = {}) => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 429 };
    assert.equal(String(url), "https://users.roblox.com/v1/usernames/users");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      usernames: [query],
      excludeBannedUsers: false
    });
    return {
      ok: true,
      json: async () => ({
        data: [{ id: 67890, name: query, displayName: "Exact Match", hasVerifiedBadge: true }]
      })
    };
  };

  const query = "fallback-user-" + Date.now();
  const users = await searchRobloxUsers(query);
  assert.equal(calls, 2);
  assert.equal(users[0].id, "67890");
  assert.equal(users[0].username, query);
});

test("reports failure only when both Roblox search endpoints fail", async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    searchRobloxUsers("failed-search-" + Date.now()),
    /keyword search returned HTTP 503.*username lookup returned HTTP 503/
  );
});
