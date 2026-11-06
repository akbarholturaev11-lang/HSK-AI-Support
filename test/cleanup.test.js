import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("daily cleanup retains active monthly backup budget counter", async () => {
  const statements = [];
  const env = { DB:{
    prepare(sql) {
      const obj = {sql,args:[]};
      return {bind(...args){obj.args=args;return this;},get sql(){return obj.sql;},get args(){return obj.args;}};
    },
    async batch(queries) {
      for(const q of queries) statements.push({sql:q.sql,args:q.args});
      return [];
    }
  } };
  await worker.scheduled({cron:"0 3 * * *"},env);
  const daily=statements.find(q=>q.sql.includes("scope != 'backup-cent-monthly'"));
  const monthly=statements.find(q=>q.sql.includes("scope = 'backup-cent-monthly'"));
  assert.ok(daily);
  assert.ok(monthly);
  assert.match(monthly.args[0],/^\d{4}-\d{2}$/);
  assert.match(daily.args[0],/^\d{4}-\d{2}-\d{2}$/);
});
