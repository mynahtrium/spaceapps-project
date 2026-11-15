import test from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../../scripts/server.mjs";

test("Static server hides dotfiles (.env, .git) and survives malformed %-escapes", async () => {
  const { server, port } = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    const status = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).status;
    assert.equal(await status("/web/"), 200);
    assert.equal(await status("/.env"), 404);
    assert.equal(await status("/.env.example"), 404);
    assert.equal(await status("/.git/config"), 404);
    assert.equal(await status("/web/%2e%2e/.git/HEAD"), 404);
    assert.equal(await status("/%E0%A4%A"), 400);
    assert.equal(await status("/web/"), 200, "server still up after a malformed request");
  } finally {
    server.close();
  }
});
