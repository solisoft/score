// No view writes `.to_json` (#537): JSON in a page goes through
// json_for_script, which escapes `</script>` and U+2028/2029. A new view that
// writes `.to_json` again fails here.
//
//   node --test tests/js/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VIEWS = fileURLToPath(new URL("../../app/views/", import.meta.url));

function* templates(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* templates(path);
    else if (entry.name.endsWith(".slv")) yield path;
  }
}

test("no template writes .to_json: json_for_script does", () => {
  const writing = [...templates(VIEWS)].filter((path) => readFileSync(path, "utf8").includes(".to_json"));
  assert.deepEqual(writing, []);
});
