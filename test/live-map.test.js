const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeErlcLiveMapPlayers } = require("../server");

const portalCopies = [
  path.join(__dirname, ".."),
  path.join(__dirname, "..", "nyrp")
];

test("live map player normalization returns bounded display and coordinate data", () => {
  assert.deepEqual(normalizeErlcLiveMapPlayers([
    {
      Player: "OfficerOne:123456",
      Callsign: "Adam-12",
      Team: "Police",
      Location: {
        LocationX: -420,
        LocationZ: 275,
        PostalCode: "403",
        StreetName: "Independence Parkway",
        BuildingNumber: "14"
      }
    },
    { Player: "", Team: "Civilian" },
    { Player: "NoCoords:234567", Location: { PostalCode: "208" } }
  ]), [
    {
      username: "OfficerOne",
      callsign: "Adam-12",
      team: "Police",
      streetName: "Independence Parkway",
      buildingNumber: "14",
      postalCode: "403",
      locationX: -420,
      locationZ: 275
    },
    {
      username: "NoCoords",
      callsign: "",
      team: "Unknown",
      streetName: "",
      buildingNumber: "",
      postalCode: "208",
      locationX: null,
      locationZ: null
    }
  ]);
});

test("live map route is restricted to officers on an active law-enforcement shift in both portal copies", () => {
  for (const portalPath of portalCopies) {
    const server = fs.readFileSync(path.join(portalPath, "server.js"), "utf8");
    const index = fs.readFileSync(path.join(portalPath, "index.html"), "utf8");
    const app = fs.readFileSync(path.join(portalPath, "app.js"), "utf8");
    assert.match(server, /GET" && url\.pathname === "\/api\/erlc\/live-map"/);
    assert.match(server, /active law-enforcement shift is required to view the live map/);
    assert.match(server, /normalizeErlcLiveMapPlayers\(snapshot\.players\)/);
    assert.match(index, /data-page="live-map"/);
    assert.match(index, /\/assets\/erlc-fall-postals\.webp/);
    assert.match(app, /requestJson\("\/api\/erlc\/live-map"\)/);
    assert.match(app, /data\.policeOnDuty/);
  }
});

test("both portal copies include a compact local official ER:LC postal map", () => {
  for (const portalPath of portalCopies) {
    const mapPath = path.join(portalPath, "public", "assets", "erlc-fall-postals.webp");
    const map = fs.readFileSync(mapPath);
    assert.equal(map.toString("ascii", 0, 4), "RIFF");
    assert.equal(map.toString("ascii", 8, 12), "WEBP");
    assert.ok(map.length < 2 * 1024 * 1024);
  }
});
