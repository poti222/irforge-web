import test from "node:test";
import assert from "node:assert/strict";

// sessionStorage + window.location را شبیه‌سازی می‌کنیم (ماژول فقط به همین‌ها دست می‌زند).
const mem = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};
globalThis.window = { location: { pathname: "/", search: "", hash: "" } };
const at = (pathname) => { globalThis.window.location.pathname = pathname; };

const P = await import("../src/lib/post-auth.ts");
const reset = () => { mem.clear(); at("/"); };

test("isSafeTarget: only internal, non-auth paths", () => {
  for (const ok of ["/schools", "/schools/teacher/classes?x=1", "/learn/telegram-bot-broadcast", "/dashboard#top"]) assert.ok(P.isSafeTarget(ok), ok);
  for (const bad of ["", "/", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/javascript:alert(1)", "/login", "/register?x=1", "/auth/google/callback", "/complete-profile", "/a\nb", null, undefined, 5]) assert.ok(!P.isSafeTarget(bad), String(bad));
  assert.ok(!P.isSafeTarget("/" + "a".repeat(600)));
});

test("default target is /dashboard", () => {
  reset();
  assert.equal(P.peekPostAuthTarget(), "/dashboard");
});

test("a public page the user came from is the target after login (the /schools bug)", () => {
  reset();
  at("/schools"); P.noteVisit("/schools");
  at("/login"); P.noteVisit("/login");            // صفحه‌ی ورود هرگز مقصد را عوض نمی‌کند
  assert.equal(P.consumePostAuthTarget(), "/schools");
  assert.equal(P.peekPostAuthTarget(), "/dashboard"); // مصرف شد
});

test("deep links keep path + query", () => {
  reset();
  at("/schools/teacher/exams"); P.noteVisit("/schools/teacher/exams?tab=2");
  at("/register"); P.noteVisit("/register");
  assert.equal(P.consumePostAuthTarget(), "/schools/teacher/exams?tab=2");
});

test("visiting the home page clears the remembered page (login from home -> dashboard)", () => {
  reset();
  at("/pricing"); P.noteVisit("/pricing");
  at("/"); P.noteVisit("/");
  assert.equal(P.peekPostAuthTarget(), "/dashboard");
});

test("login <-> register hops do not lose the target", () => {
  reset();
  at("/learn/x"); P.noteVisit("/learn/x");
  at("/login"); P.noteVisit("/login");
  at("/register"); P.noteVisit("/register");
  at("/forgot-password"); P.noteVisit("/forgot-password");
  assert.equal(P.peekPostAuthTarget(), "/learn/x");
});

test("explicit target beats the remembered page, and survives the auth pages + OAuth callback", () => {
  reset();
  at("/"); P.noteVisit("/");
  P.setPostAuthTarget("/dashboard");              // دکمه‌ی «ساخت بات» در صفحه‌ی اصلی
  at("/login"); P.noteVisit("/login");
  at("/auth/google/callback"); P.noteVisit("/auth/google/callback");
  assert.equal(P.consumePostAuthTarget(), "/dashboard");
});

test("a stale explicit target is dropped when the user browses elsewhere", () => {
  reset();
  at("/"); P.setPostAuthTarget("/dashboard");     // کلیک کرد ولی لاگین نکرد
  at("/pricing"); P.noteVisit("/pricing");        // رفت صفحه‌ی دیگر
  at("/login"); P.noteVisit("/login");
  assert.equal(P.consumePostAuthTarget(), "/pricing");
});

test("guard case: protected page opened while logged out -> back to exactly that page, even through complete-profile", () => {
  reset();
  at("/schools/parent/children");
  P.setPostAuthTarget("/schools/parent/children?x=1");   // RedirectToLogin در رندر
  P.noteVisit("/schools/parent/children?x=1");           // ردیابی همان لحظه‌ی رندر: نباید پاکش کند
  at("/login"); P.noteVisit("/login");
  at("/complete-profile"); P.noteVisit("/complete-profile");
  assert.equal(P.consumePostAuthTarget(), "/schools/parent/children?x=1");
});

test("?next= is honoured only for safe targets", () => {
  reset();
  at("/login");
  P.captureNextParam("/login", "?next=//evil.com");
  assert.equal(P.peekPostAuthTarget(), "/dashboard");
  P.captureNextParam("/login", "?next=%2Fschools%2Fteacher");
  assert.equal(P.consumePostAuthTarget(), "/schools/teacher");
  P.captureNextParam("/pricing", "?next=/schools");       // فقط روی صفحه‌های ورود
  assert.equal(P.peekPostAuthTarget(), "/dashboard");
});

test("legacy plain-string value is still read", () => {
  reset();
  mem.set("irforge_post_auth", "/schools");
  assert.equal(P.peekPostAuthTarget(), "/schools");
});
