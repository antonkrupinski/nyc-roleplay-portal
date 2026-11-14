const test = require("node:test");
const assert = require("node:assert/strict");
const { parseErlcCommandPayload } = require("../server");

test("parses the :s shortcut as a scene command with an optional radius", () => {
  assert.deepEqual(
    parseErlcCommandPayload({
      message: ":s 250",
      player: "TestPlayer:123456"
    }),
    {
      command: "scene",
      playerName: "TestPlayer",
      robloxId: "123456",
      radiusStuds: 250
    }
  );
});

test("does not treat the old ;s shortcut as a scene command", () => {
  assert.equal(parseErlcCommandPayload({
    message: ";s",
    player: "TestPlayer:123456"
  }), null);
});

test("keeps other in-game command prefixes working", () => {
  assert.equal(parseErlcCommandPayload({
    message: ";traffic",
    player: "TestPlayer:123456"
  }).command, "traffic");
  assert.equal(parseErlcCommandPayload({
    message: "!prtyend",
    player: "TestPlayer:123456"
  }).command, "priority-end");
});
