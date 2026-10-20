/**
 * e2e-ui/emoji-ui.test.jsx — دکمه‌ی ایموجی، Input/Textarea و CustomEmojiManager در jsdom (کلیکِ واقعی).
 *
 * vitest در پکیجِ irforge نصب نیست (عمداً)؛ برای اجرا یک پوشه‌ی موقت بسازید:
 *   mkdir /tmp/uitest && cd /tmp/uitest && npm init -y && npm i -D vitest@2 jsdom @testing-library/react@16 @testing-library/user-event @testing-library/dom
 *   # react/react-dom آن‌جا را به نسخه‌ی irforge/node_modules لینک کنید (وگرنه دو کپیِ React می‌شود)
 *   # مسیرهای absolute داخل این فایل و vitest.config.mjs را با پروژه‌ی خودتان عوض کنید
 *   npx vitest run --config vitest.config.mjs
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "/home/claude/w/irforge-web-main/irforge/node_modules/@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { EmojiProvider } from "@/components/emoji/emoji-context";
import { CustomEmojiManager } from "@/components/emoji/CustomEmojiManager";
import { insertAtCursor } from "@/lib/custom-emoji";

const EMOJIS = [
  { name: "fire", id: "5368324170671202286", fallback: "🔥", animated: true, enabled: true, pack: "FirePack" },
  { name: "party", id: "5368324170671202287", fallback: "🎉", animated: true, enabled: true, pack: "FirePack" },
  { name: "hidden", id: "5368324170671202288", fallback: "👻", animated: false, enabled: false, pack: "FirePack" },
];
let calls;
beforeEach(() => {
  cleanup(); calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url); calls.push({ u, method: init?.method ?? "GET", body: init?.body });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (u.endsWith("/custom-emojis") && (init?.method ?? "GET") === "GET") return json({ emojis: EMOJIS });
    if (u.endsWith("/custom-emojis") && init?.method === "PUT") return json({ emojis: JSON.parse(init.body).emojis });
    if (u.endsWith("/import-pack")) return json({ emojis: [...EMOJIS, { name: "newpack_1", id: "9990001", fallback: "⭐", animated: true, enabled: true, pack: "NewPack" }], report: [{ pack: "NewPack", added: 1 }] });
    return json({}, 404);
  });
});
const wrap = (ui) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><EmojiProvider botId="bot1">{ui}</EmojiProvider></QueryClientProvider>);
};

describe("insertAtCursor", () => {
  it("inserts at caret, replaces a selection, appends when no caret", () => {
    expect(insertAtCursor("hello world", ":fire:", 5, 5)).toEqual({ next: "hello:fire: world", caret: 11 });
    expect(insertAtCursor("hello world", ":fire:", 0, 5)).toEqual({ next: ":fire: world", caret: 6 });
    expect(insertAtCursor("abc", ":x1:", null, null)).toEqual({ next: "abc:x1:", caret: 7 });
  });
});

describe("Textarea / Input outside an EmojiProvider are unchanged", () => {
  it("renders a bare textarea (no wrapper div, no picker button)", () => {
    const { container } = render(<Textarea defaultValue="x" />);
    expect(container.firstElementChild.tagName).toBe("TEXTAREA");
    expect(screen.queryByTestId("emoji-picker-trigger")).toBeNull();
  });
  it("forwards ref and className to the native element", () => {
    const ref = React.createRef();
    const { container } = render(<Input ref={ref} className="my-class" type="email" />);
    expect(ref.current).toBe(container.querySelector("input"));
    expect(ref.current.className).toContain("my-class");
    expect(ref.current.type).toBe("email");
  });
});

describe("inside EmojiProvider", () => {
  it("Textarea shows the picker, lists only ENABLED emojis, and inserts :name: into a CONTROLLED textarea", async () => {
    const user = userEvent.setup();
    function Controlled() { const [v, setV] = React.useState("سلام "); return <><Textarea value={v} onChange={(e) => setV(e.target.value)} aria-label="msg" /><output data-testid="state">{v}</output></>; }
    wrap(<Controlled />);
    const trigger = await screen.findByTestId("emoji-picker-trigger");
    await user.click(trigger);
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["🔥", "🎉"]); // hidden (disabled) is not offered
    await user.click(options[0]);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("سلام :fire:"));
    expect(screen.getByLabelText("msg").value).toBe("سلام :fire:"); // React state and DOM agree
  });
  it("after the user placed the caret mid-text, the emoji goes at the caret (not the end)", async () => {
    const user = userEvent.setup();
    function Controlled() { const [v, setV] = React.useState("ab cd"); return <Textarea value={v} onChange={(e) => setV(e.target.value)} aria-label="msg" />; }
    wrap(<Controlled />);
    const ta = screen.getByLabelText("msg");
    await user.click(ta);
    ta.setSelectionRange(2, 2);
    await user.click(await screen.findByTestId("emoji-picker-trigger"));
    await user.click(within(await screen.findByRole("listbox")).getAllByRole("option")[0]);
    await waitFor(() => expect(ta.value).toBe("ab:fire: cd"));
  });
  it("search filters by name / fallback / pack", async () => {
    const user = userEvent.setup();
    wrap(<Textarea defaultValue="" />);
    await user.click(await screen.findByTestId("emoji-picker-trigger"));
    await user.type(await screen.findByPlaceholderText("جستجو…"), "party");
    const opts = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(opts.map((o) => o.textContent)).toEqual(["🎉"]);
  });
  it("Input is opt-in: no button by default, button + insertion with `emoji`", async () => {
    const user = userEvent.setup();
    const { rerender } = wrap(<Input aria-label="t" defaultValue="" />);
    await screen.findByLabelText("t");
    expect(screen.queryByTestId("emoji-picker-trigger")).toBeNull();
    cleanup();
    wrap(<Input emoji aria-label="t2" defaultValue="ab" />);
    await user.click(await screen.findByTestId("emoji-picker-trigger"));
    await user.click(within(await screen.findByRole("listbox")).getAllByRole("option")[1]);
    await waitFor(() => expect(screen.getByLabelText("t2").value).toBe("ab:party:"));
  });
  it("number/password inputs never get the button even with emoji", async () => {
    wrap(<><Input emoji type="password" aria-label="p" /><Input emoji type="number" aria-label="n" /></>);
    await screen.findByLabelText("p");
    expect(screen.queryByTestId("emoji-picker-trigger")).toBeNull();
  });
  it("disabled / readOnly fields get no button", async () => {
    wrap(<><Textarea disabled aria-label="d" /><Textarea readOnly aria-label="r" /></>);
    await screen.findByLabelText("d");
    expect(screen.queryByTestId("emoji-picker-trigger")).toBeNull();
  });
  it("empty catalog ⇒ picker explains how to add emojis", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ emojis: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const user = userEvent.setup();
    wrap(<Textarea defaultValue="" />);
    await user.click(await screen.findByTestId("emoji-picker-trigger"));
    expect(await screen.findByText(/هنوز ایموجی‌ای فعال نشده/)).toBeTruthy();
  });
});

describe("CustomEmojiManager", () => {
  it("lists the catalog and imports a pack through the API", async () => {
    const user = userEvent.setup();
    wrap(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getAllByText(/fire/).length).toBeGreaterThan(0));
    const box = screen.getAllByRole("textbox").find((el) => /addemoji|NAME|پک/i.test(el.getAttribute("placeholder") ?? "")) ?? screen.getAllByRole("textbox")[0];
    await user.type(box, "NewPack");
    const addBtn = screen.getAllByRole("button").find((b) => /افزودن|اضافه|وارد/.test(b.textContent ?? ""));
    expect(addBtn).toBeTruthy();
    await user.click(addBtn);
    await waitFor(() => expect(calls.some((c) => c.u.endsWith("/import-pack") && c.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.u.endsWith("/import-pack")).body)).toEqual({ packs: ["NewPack"] });
    await waitFor(() => expect(screen.getByDisplayValue("newpack_1")).toBeTruthy());
  });
  it("editing one of two clashing names does not change the other (edit by id)", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ emojis: [
      { name: "same", id: "1000001", fallback: "🔥", animated: true, enabled: true, pack: "A" },
      { name: "same", id: "1000002", fallback: "🎉", animated: true, enabled: true, pack: "A" },
    ] }), { status: 200, headers: { "content-type": "application/json" } }));
    wrap(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getAllByDisplayValue("same")).toHaveLength(2));
    const [first, second] = screen.getAllByDisplayValue("same");
    await user.type(first, "x");
    expect(first.value).toBe("samex");
    expect(second.value).toBe("same");
    await user.click(screen.getAllByRole("switch")[0]);
    expect(screen.getAllByRole("switch")[1].getAttribute("aria-checked")).toBe("true");
  });
  it("pack import is blocked while there are unsaved edits (it would silently discard them)", async () => {
    const user = userEvent.setup();
    wrap(<CustomEmojiManager />);
    await waitFor(() => expect(screen.getAllByDisplayValue("fire").length).toBe(1));
    await user.click(screen.getAllByRole("switch")[0]);
    await user.type(screen.getAllByRole("textbox").find((el) => /addemoji/.test(el.getAttribute("placeholder") ?? "")), "Pack");
    expect(screen.getByRole("button", { name: /افزودنِ پک/ }).disabled).toBe(true);
  });
});
