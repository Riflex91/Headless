"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const prettier = require("prettier");

function sameRun(left, leftAt, right, rightAt, count = 4) {
  for (let offset = 0; offset < count; offset += 1) {
    if (left[leftAt + offset] !== right[rightAt + offset]) return false;
  }
  return true;
}

function compactLineHunks(source, formatted) {
  const left = source.split("\n");
  const right = formatted.split("\n");
  const hunks = [];
  let i = 0;
  let j = 0;

  while (i < left.length || j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }

    let match = null;
    const maxWindow = 160;
    for (let span = 0; span <= maxWindow * 2 && !match; span += 1) {
      for (let di = 0; di <= Math.min(maxWindow, span); di += 1) {
        const dj = span - di;
        if (dj > maxWindow) continue;
        if (
          i + di + 4 <= left.length &&
          j + dj + 4 <= right.length &&
          sameRun(left, i + di, right, j + dj)
        ) {
          match = { di, dj };
          break;
        }
      }
    }

    if (!match) {
      hunks.push({
        start: i,
        deleteCount: left.length - i,
        insert: right.slice(j),
      });
      break;
    }

    hunks.push({
      start: i,
      deleteCount: match.di,
      insert: right.slice(j, j + match.dj),
    });
    i += match.di;
    j += match.dj;
  }

  return hunks;
}

test("print compact Prettier hunks for CharacterCoordinator", async () => {
  const file = path.join(
    __dirname,
    "..",
    "standalones",
    "CharacterCoordinator.js",
  );
  const source = fs.readFileSync(file, "utf8");
  const formatted = await prettier.format(source, { filepath: file });
  const hunks = compactLineHunks(source, formatted);
  console.log(
    "PRETTIER_HUNKS CharacterCoordinator.js " +
      Buffer.from(JSON.stringify(hunks)).toString("base64"),
  );
});
