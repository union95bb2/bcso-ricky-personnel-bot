import test from "node:test";
import assert from "node:assert/strict";
import { departureEmbed, departureNoticeContent } from "../src/departure.js";

test("departure notice pings PAB and stays administrative", () => {
  const content = departureNoticeContent({ pabRoleId: "123456789012345678", memberLabel: "C-210 | Sr Dep John D." });
  assert.match(content, /<@&123456789012345678>/);
  assert.match(content, /no longer in the BCSO Discord/);
  assert.match(content, /roster\/RMS/);
});

test("departure embed records activity and role context without discipline decisions", () => {
  const embed = departureEmbed({
    memberLabel: "C-210 | Sr Dep John D.",
    userTag: "newbietrucker2024",
    roleLabels: ["Deputy", "BCSO"],
    lastActivity: { occurredAt: 1_700_000_000_000, source: "discord-message" },
    timestamp: 1_700_000_001_000
  }).toJSON();
  assert.equal(embed.title, "BCSO Departure Notice");
  const fields = Object.fromEntries(embed.fields.map(field => [field.name, field.value]));
  assert.match(fields["Last known Ricky activity"], /discord-message/);
  assert.equal(fields["Roles at departure"], "Deputy, BCSO");
  assert.match(fields["Required follow-up"], /does not make a disciplinary/);
});

