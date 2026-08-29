import { test } from "node:test";
import assert from "node:assert/strict";
import { nameGenderMismatch, isFakeName } from "../src/lib/identityHeuristics.ts";

test("nameGenderMismatch: a clearly male name declared female is a mismatch", () => {
  assert.equal(nameGenderMismatch("John Smith", "female"), true);
  assert.equal(nameGenderMismatch("علی رضایی", "female"), true);
});

test("nameGenderMismatch: a clearly female name declared male is a mismatch", () => {
  assert.equal(nameGenderMismatch("Sarah Connor", "male"), true);
  assert.equal(nameGenderMismatch("زهرا احمدی", "male"), true);
});

test("nameGenderMismatch: a matching name/gender pair is not a mismatch", () => {
  assert.equal(nameGenderMismatch("John Smith", "male"), false);
  assert.equal(nameGenderMismatch("زهرا احمدی", "female"), false);
});

test("nameGenderMismatch: an unknown first name is silently skipped, never flagged", () => {
  assert.equal(nameGenderMismatch("Xyzzy Plugh", "male"), false);
  assert.equal(nameGenderMismatch("Xyzzy Plugh", "female"), false);
});

test("nameGenderMismatch: an empty/blank name never mismatches", () => {
  assert.equal(nameGenderMismatch("", "male"), false);
  assert.equal(nameGenderMismatch("   ", "female"), false);
});

test("isFakeName: rejects all-digit input", () => {
  assert.equal(isFakeName("123456"), true);
});

test("isFakeName: rejects a single character", () => {
  assert.equal(isFakeName("A"), true);
  assert.equal(isFakeName("ا"), true);
});

test("isFakeName: rejects one character repeated, spaces ignored", () => {
  assert.equal(isFakeName("aaaa"), true);
  assert.equal(isFakeName("a a a a"), true);
  assert.equal(isFakeName("ررررر"), true);
});

test("isFakeName: accepts a real-looking name", () => {
  assert.equal(isFakeName("Ali Rezaei"), false);
  assert.equal(isFakeName("علی رضایی"), false);
});
