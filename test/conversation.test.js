import test from "node:test";
import assert from "node:assert/strict";
import { redactForContext, readConversation, storeConversation } from "../src/conversation.js";

function mockDb() {
  const rows = new Map();
  const DB = { prepare(sql) {
    return { bind(...args) {
      return {
        async first() {
          if (!sql.startsWith("SELECT turns_json")) throw Error("unexpected query");
          return rows.get(args[0]) || null;
        },
        async run() {
          if (!sql.startsWith("INSERT INTO support_context")) throw Error("unexpected insert");
          rows.set(args[0], { turns_json: args[1], updated_at: args[2] });
          return { meta:{ changes:1 } };
        }
      };
    } };
  } };
  return { DB, rows };
}

test("sanitized context never stores email, phone number, URL, Telegram username or long token", () => {
  const clean = redactForContext("Email me user@example.com or +998 90 123 45 67 at https://site.example @testuser abcdefghijklmnopqrstuvwxyz12345");
  assert.ok(!clean.includes("user@example.com"));
  assert.ok(!clean.includes("998"));
  assert.ok(!clean.includes("@testuser"));
  assert.ok(!clean.includes("abcdefghijklmnopqrstuvwxyz"));
  assert.equal(redactForContext("Мой CVV 123"), "");
});

test("keeps only five combined user/assistant turns and expires after one hour", async () => {
  const db = mockDb(), env = {DB:db.DB};
  let history = [];
  for (let i=0; i<5; i++) {
    await storeConversation(env, 11, history, "iPhone савол " + i, "Жавоб " + i, 1000+i);
    history = await readConversation(env, 11, 1000+i);
  }
  assert.equal(history.length, 5);
  assert.equal(history.at(-1).role, "assistant");
  assert.equal((await readConversation(env,11,5000)).length, 0);
  assert.equal(db.rows.size, 1);
});

test("database errors disable only optional context; support can continue", async () => {
  assert.deepEqual(await readConversation({DB:{prepare(){throw Error("db")}}}, 5), []);
  assert.equal(await storeConversation({DB:{prepare(){throw Error("db")}}},5,[],"HSK AI","Жавоб"),undefined);
});
