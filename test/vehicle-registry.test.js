const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeVehicleStatus, normalizeVehicleStatuses } = require("../server");

const portalCopies = [
  path.join(__dirname, ".."),
  path.join(__dirname, "..", "nyrp")
];

test("shared vehicle registry accepts only Valid, Stolen, and Expired statuses", () => {
  assert.equal(normalizeVehicleStatus("valid"), "Valid");
  assert.equal(normalizeVehicleStatus("Stolen"), "Stolen");
  assert.equal(normalizeVehicleStatus("EXPIRED"), "Expired");
  assert.equal(normalizeVehicleStatus("Wanted"), null);
  assert.deepEqual(normalizeVehicleStatuses({
    "ABC-123": "Stolen",
    " xyz 987 ": "Expired",
    "invalid plate": "Unknown"
  }), {
    ABC123: "Stolen",
    XYZ987: "Expired"
  });
});

test("both portal copies read and update shared, owner-verified vehicle statuses", () => {
  for (const portalPath of portalCopies) {
    const server = fs.readFileSync(path.join(portalPath, "server.js"), "utf8");
    const app = fs.readFileSync(path.join(portalPath, "app.js"), "utf8");
    assert.match(server, /vehicleStatuses:\s*normalizeVehicleStatuses\(record\.vehicleStatuses\)/);
    assert.match(server, /POST" && url\.pathname === "\/api\/erlc\/vehicles\/status"/);
    assert.match(server, /That plate is not one of your currently listed ER:LC vehicles/);
    assert.match(server, /\[plateKey\]: status/);
    assert.match(app, /requestJson\("\/api\/erlc\/vehicles\/status"/);
    assert.match(app, /Shared CAD vehicle status updated/);
  }
});
