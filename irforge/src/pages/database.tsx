import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Database as DatabaseIcon,
  Loader2,
  ExternalLink,
  RefreshCw,
  Table as TableIcon,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/hooks/use-language";
import { useT } from "@/hooks/use-translation";

type Target = { target: string; label: string; kind: string; sheetId: string };
type Row = { key: string; value: unknown; raw: boolean };

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

/**
 * Rows that exist for the bot runtime, not for the person reading this page:
 * internal identifiers, credentials and implementation metadata. They are
 * noise at best and sensitive at worst, so they never reach the table.
 *
 * The count of what was filtered is shown in the UI — hiding rows silently
 * would make the page look like it was missing data.
 */
const INTERNAL_KEY = /^_|(^|_)ids?$|token|secret|hash|password|api_?key|webhook|internal|_meta$/i;

/** Full value as text — strings stay plain, objects pretty-print. */
function valueToText(value: unknown, raw: boolean): string {
  if (raw || typeof value === "string") return String(value ?? "");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

/** Short one-line preview of a value for the table. */
function preview(value: unknown, raw: boolean): string {
  if (raw || typeof value === "string") return String(value ?? "");
  try {
    const s = JSON.stringify(value);
    return s.length > 90 ? s.slice(0, 89) + "…" : s;
  } catch {
    return String(value);
  }
}

export default function DatabasePage() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const tr = useT("database");

  const [target, setTarget] = useState<string>("");
  const [tab, setTab] = useState<string>("");

  const t = (f: string, e: string) => (fa ? f : e);

  // ─── targets ──────────────────────────────────────────────────────────────
  const targetsQ = useQuery({
    queryKey: ["db", "targets"],
    queryFn: () => customFetch<{ targets: Target[]; isSuperAdmin: boolean }>("/api/database/targets"),
  });

  const targets = targetsQ.data?.targets ?? [];
  useEffect(() => {
    if (!target && targets.length) setTarget(targets[0].target);
  }, [targets, target]);

  const activeTarget = targets.find((x) => x.target === target);

  // ─── tabs ─────────────────────────────────────────────────────────────────
  const tabsQ = useQuery({
    queryKey: ["db", "tabs", target],
    queryFn: () => customFetch<{ tabs: string[]; label: string }>(`/api/database/${encodeURIComponent(target)}/tabs`),
    enabled: !!target,
  });
  const tabs = useMemo(() => tabsQ.data?.tabs ?? [], [tabsQ.data]);
  useEffect(() => {
    if (tabs.length && !tabs.includes(tab)) setTab(tabs[0]);
  }, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── rows ─────────────────────────────────────────────────────────────────
  const rowsQ = useQuery({
    queryKey: ["db", "rows", target, tab],
    queryFn: () => customFetch<{ rows: Row[] }>(`/api/database/${encodeURIComponent(target)}/tabs/${encodeURIComponent(tab)}/rows`),
    enabled: !!target && !!tab,
  });
  const allRows = rowsQ.data?.rows ?? [];
  const rows = useMemo(() => allRows.filter((r) => !INTERNAL_KEY.test(r.key)), [allRows]);
  const hiddenCount = allRows.length - rows.length;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <DatabaseIcon className="size-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{t("دیتابیس", "Database")}</h1>
            <Badge variant="secondary" className="gap-1">
              <Eye className="size-3" />
              {tr.readOnlyBadge}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{tr.readOnlyNotice}</p>
        </div>
        {activeTarget && (
          <a href={sheetUrl(activeTarget.sheetId)} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm">
              <ExternalLink className="me-1.5 size-4" />
              {t("باز کردن در گوگل", "Open in Google")}
            </Button>
          </a>
        )}
      </div>

      {/* target selector */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">{t("دیتابیس (بات/سیستم)", "Database (bot/system)")}</label>
            <Select value={target} onValueChange={(v) => { setTarget(v); setTab(""); }}>
              <SelectTrigger data-testid="db-target"><SelectValue placeholder={t("انتخاب کن", "Select")} /></SelectTrigger>
              <SelectContent>
                {targets.map((x) => (
                  <SelectItem key={x.target} value={x.target}>
                    {x.label}{x.kind !== "bot" ? ` · ${t("سیستمی", "system")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="icon" className="mt-4 shrink-0" onClick={() => { tabsQ.refetch(); rowsQ.refetch(); }} aria-label={t("تازه‌سازی", "Refresh")}>
            <RefreshCw className="size-4" />
          </Button>
        </CardContent>
      </Card>

      {targetsQ.isLoading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{t("در حال بارگذاری…", "Loading…")}</CardContent></Card>
      ) : targets.length === 0 ? (
        <div className="rounded-xl border border-dashed py-14 text-center">
          <DatabaseIcon className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("هنوز باتی با شیت اختصاصی نداری. اول یه بات بساز و شیت بهش وصل کن.", "No bot with a sheet yet. Create a bot and attach a sheet first.")}</p>
        </div>
      ) : (
        <>
          {/* tabs row */}
          <div className="flex flex-wrap items-center gap-2">
            {tabsQ.isLoading ? (
              <span className="text-sm text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /> {t("تب‌ها…", "Tabs…")}</span>
            ) : tabs.map((tb) => (
              <button
                key={tb}
                onClick={() => setTab(tb)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${tb === tab ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}
                data-testid={`db-tab-${tb}`}
              >
                <TableIcon className="size-3" />{tb}
              </button>
            ))}
          </div>

          {/* rows */}
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <span className="text-sm font-medium">
                  {tab || t("یک تب انتخاب کن", "Pick a tab")}
                  {rows.length > 0 && <span className="ms-2 text-xs text-muted-foreground">({rows.length.toLocaleString(fa ? "fa-IR" : "en-US")})</span>}
                </span>
                {hiddenCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {tr.hiddenRowsNote.replace("{count}", hiddenCount.toLocaleString(fa ? "fa-IR" : "en-US"))}
                  </span>
                )}
              </div>

              {rowsQ.isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 size-5 animate-spin" />{t("در حال بارگذاری…", "Loading…")}</div>
              ) : rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">{t("این تب خالیه.", "This tab is empty.")}</div>
              ) : (
                <div className="divide-y">
                  {rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-3 p-3 hover:bg-muted/30">
                      <span className="w-40 shrink-0 truncate font-mono text-xs text-primary" dir="ltr" title={r.key}>{r.key}</span>
                      <span
                        className="flex-1 truncate font-mono text-xs text-muted-foreground"
                        dir="ltr"
                        title={valueToText(r.value, r.raw)}
                      >
                        {preview(r.value, r.raw)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
