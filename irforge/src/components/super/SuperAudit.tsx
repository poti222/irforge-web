import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshButton } from "@/components/ui/refresh-button";
import { useLanguage } from "@/hooks/use-language";
import { SUPER_QUERY_ROOT, getSuperAudit } from "./superApi";

/**
 * components/super/SuperAudit.tsx — `/super` ← «ردپا»: دیدنِ ردپایِ سراسری.
 *  - «ادمین»: `admin_audit_log` (تغییرِ نقش/رمز/پلن/کیف‌پول، impersonation، حذفِ کاربر، تنظیمِ کانالِ پرداخت…)
 *  - «مدارس»: `school_audit_log` همه‌یِ مدارس (تغییرِ نقش، حذفِ عضو، کدِ معرف، هشدار، کارهایِ /super).
 * فقط‌خواندنی؛ شماره‌کارت/راز هرگز در این لاگ‌ها نیست (lib/audit.ts).
 */

const PAGE = 25;
const ALL = "__all__";

export function SuperAudit() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [source, setSource] = useState<"admin" | "school">("admin");
  const [action, setAction] = useState(ALL);
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [offset, setOffset] = useState(0);

  const key = [SUPER_QUERY_ROOT, "audit", source, action, applied, offset] as const;
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => getSuperAudit({ source, action: action === ALL ? undefined : action, q: applied || undefined, limit: PAGE, offset }),
    placeholderData: (prev) => prev,
  });

  const reset = () => setOffset(0);
  const total = data?.total ?? 0;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-base font-semibold">{fa ? "ردپایِ سراسری" : "Global audit trail"}{data ? <span className="ms-2 text-sm font-normal text-muted-foreground">({total.toLocaleString("en-US")})</span> : null}</h2>
          <Select value={source} onValueChange={(v) => { setSource(v as any); setAction(ALL); reset(); }}>
            <SelectTrigger className="h-9 w-40" data-testid="audit-source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{fa ? "ادمین (کاربران/مالی)" : "Admin (users/finance)"}</SelectItem>
              <SelectItem value="school">{fa ? "مدارس" : "Schools"}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={(v) => { setAction(v); reset(); }}>
            <SelectTrigger className="h-9 w-52" data-testid="audit-action"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{fa ? "همه‌یِ اقدام‌ها" : "All actions"}</SelectItem>
              {(data?.actions ?? []).map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <form className="relative" onSubmit={(e) => { e.preventDefault(); setApplied(q.trim()); reset(); }}>
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={fa ? "جست‌وجو و Enter" : "Search, press Enter"} className="h-9 w-48 ps-8" data-testid="audit-q" />
          </form>
          <RefreshButton queryKeys={[[SUPER_QUERY_ROOT, "audit"]]} label={fa ? "به‌روزرسانی" : "Refresh"} />
        </div>

        {isLoading ? (
          <div className="flex h-20 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <p className="text-sm text-destructive">{fa ? "دریافتِ ردپا ممکن نشد." : "Couldn't load the audit trail."}</p>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{fa ? "موردی ثبت نشده." : "Nothing recorded."}</p>
        ) : (
          <div className="overflow-x-auto" aria-busy={isFetching}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fa ? "زمان" : "When"}</TableHead>
                  <TableHead>{fa ? "اقدام" : "Action"}</TableHead>
                  <TableHead>{fa ? "انجام‌دهنده" : "Actor"}</TableHead>
                  <TableHead>{source === "school" ? (fa ? "مدرسه / شرح" : "School / detail") : (fa ? "هدف / دلیل" : "Target / reason")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((i) => (
                  <TableRow key={i.id} data-testid="audit-row">
                    <TableCell className="whitespace-nowrap text-xs">{new Date(i.at).toLocaleString(fa ? "fa-IR" : "en-US")}</TableCell>
                    <TableCell><Badge variant="outline" className="font-mono text-[11px]">{i.action}</Badge></TableCell>
                    <TableCell className="text-sm">{i.actor}</TableCell>
                    <TableCell className="max-w-md text-xs">
                      {source === "school"
                        ? <><span className="font-medium">{i.schoolName ?? i.schoolId}</span><br /><span className="text-muted-foreground">{i.target}</span></>
                        : <>{i.target ?? "—"}{i.reason ? <><br /><span className="text-muted-foreground">{i.reason}</span></> : null}
                          {i.metadata ? <code className="mt-0.5 block max-w-full truncate text-[10px] text-muted-foreground" dir="ltr" title={JSON.stringify(i.metadata)}>{JSON.stringify(i.metadata)}</code> : null}</>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {total > PAGE && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground" dir="ltr">{offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} data-testid="audit-prev">{fa ? "قبلی" : "Previous"}</Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} data-testid="audit-next">{fa ? "بعدی" : "Next"}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
