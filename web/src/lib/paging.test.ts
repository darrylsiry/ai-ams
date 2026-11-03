import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_SIZE, paging } from "./paging";

test("paging: rows for a page, and the last page holds the remainder", () => {
  assert.deepEqual(paging("2", 120), { page: 2, pages: 3, size: PAGE_SIZE, offset: 50, total: 120, first: 51, last: 100 });
  assert.deepEqual(paging("3", 120), { page: 3, pages: 3, size: PAGE_SIZE, offset: 100, total: 120, first: 101, last: 120 });
});

test("paging: a bad or stale page number lands on a real page", () => {
  for (const bad of [undefined, "", "abc", "-1", "1.5", "0"]) assert.equal(paging(bad, 120).page, 1, String(bad));
  assert.equal(paging("99", 120).page, 3, "past the end: the last page");
  assert.equal(paging("9".repeat(400), 120).page, 3, "an absurd number too");
});

test("paging: an empty list is one empty page", () => {
  assert.deepEqual(paging("5", 0), { page: 1, pages: 1, size: PAGE_SIZE, offset: 0, total: 0, first: 0, last: 0 });
});

test("paging: a board column can use its own size", () => {
  assert.equal(paging("2", 60, 25).offset, 25);
  assert.equal(paging("2", 60, 25).pages, 3);
});
