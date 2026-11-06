import test from "node:test";
import assert from "node:assert/strict";
import { selectTopics, loadKnowledge } from "../src/knowledge.js";

const sha = "b".repeat(40);
function kb({ missing = [], corrupt = [] } = {}) {
  const reads = [];
  return {
    reads,
    env: { KB: { async get(key) {
      reads.push(key);
      const topic = key.split("/").at(-1).replace(".json", "");
      if (missing.includes(topic)) return null;
      return { json: async () => corrupt.includes(topic) ?
        { topic, source_commit: sha, facts: ["ok", null] } :
        { topic, source_commit: sha, facts: ["English fact for " + topic] }
      };
    } } }
  };
}

test("routes English, Russian, Tajik and Uzbek questions into a maximum of two R2 topic files", () => {
  assert.deepEqual(selectTopics("Почему оплата через Alipay не прошла?").slice(0,1), ["payments"]);
  assert.ok(selectTopics("Ҳисоби манга кириш керак").includes("accounts"));
  assert.ok(selectTopics("Тўлов нега ўтмади?").includes("payments"));
  assert.ok(selectTopics("How does the iPhone PWA work?").includes("pwa"));
  assert.deepEqual(selectTopics("Что такое HSK AI?"), ["general"]);
  assert.deepEqual(selectTopics("Hello there"), []);
  assert.ok(selectTopics("HSK AI Android account payment question").length <= 2);
});

test("R2 retrieval requires every selected topic file to have validated English facts", async () => {
  const r = kb();
  const out = await loadKnowledge(r.env, "HSK AI Android");
  assert.deepEqual(out.topics, ["android", "general"]);
  assert.equal(r.reads.length, 2);
  assert.ok(out.facts.includes("English fact for android"));
  assert.equal(await loadKnowledge(kb({missing:["android"]}).env, "Android"), null);
  assert.equal(await loadKnowledge(kb({corrupt:["android"]}).env, "Android"), null);
  assert.equal(await loadKnowledge({}, "Android"), null);
});

test("an ambiguous follow-up can use previous short context to select a topic", async () => {
  const r = kb();
  const out = await loadKnowledge(r.env, "Энди нима қиламан?", [{ role:"user", content:"Android иловага киролмаяпман" }]);
  assert.ok(out);
  assert.ok(out.topics.includes("android") || out.topics.includes("accounts"));
  assert.equal(r.reads.length <= 2, true);
});

test("invalid or unexpected R2 JSON safely escalates", async () => {
  const env = { KB: { get: async () => ({ json: async () => ({ topic:"general", source_commit:"not-sha", facts:["foo"] }) }) } };
  assert.equal(await loadKnowledge(env,"HSK AI"),null);
});
