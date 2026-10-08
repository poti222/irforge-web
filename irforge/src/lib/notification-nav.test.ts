import { describe, it, expect } from "vitest";
import { navDotSeverities, navKeyForNotification, navKeyForPath } from "./notification-nav";

const n = (type: string, severity: "info" | "warning" | "critical" = "info", read = false) =>
  ({ id: type, botId: null, type, severity, title: "", message: "", read, refId: null, createdAt: "" }) as any;

describe("notification → sidebar dots", () => {
  it("maps each type to one nav item", () => {
    expect(navKeyForNotification("ticket_reply")).toBe("tickets");
    expect(navKeyForNotification("purchase_success")).toBe("bots");
    expect(navKeyForNotification("trial_warning")).toBe("bots");
    expect(navKeyForNotification("wallet_topup_confirmed")).toBe("billing");
    expect(navKeyForNotification("site_update")).toBe("updates");
    expect(navKeyForNotification("role_changed")).toBeNull();
  });
  it("unread only, highest severity per item", () => {
    const d = navDotSeverities([n("ticket_reply"), n("ticket_new", "warning"), n("site_update", "info", true), n("role_changed")]);
    expect(d).toEqual({ tickets: "warning" });
  });
  it("path → key", () => {
    expect(navKeyForPath("/tickets")).toBe("tickets");
    expect(navKeyForPath("/bots/abc")).toBe("bots");
    expect(navKeyForPath("/invoices")).toBe("billing");
    expect(navKeyForPath("/support")).toBeNull();
  });
});
