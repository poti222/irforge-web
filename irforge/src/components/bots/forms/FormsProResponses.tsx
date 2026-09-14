/**
 * FormsProResponses.tsx — IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT بخشِ ۲.
 *
 * تبِ «فرم‌هایِ مستقل» در سکشنِ فرم‌ها: آرشیوِ فقط‌خواندنیِ پلاگینِ
 * forms_pro (دستورِ /forms_admin رویِ بات). ساخت/ویرایشِ سؤال همچنان از
 * کنسولِ بات است — این‌جا فقط لیستِ فرم‌ها + پاسخ‌هایِ هرکدام با جست‌وجو
 * و خروجیِ CSV.
 */
import { useState } from "react";
import { Download, Loader2, MessageSquareText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/use-translation";
import {
  apiErrorCode, apiErrorMessage, useFormsProForms, useFormsProSubmissions,
  type FormsProForm,
} from "./formsProApi";

function ResponsesDialog({
  botId, form, onOpenChange,
}: { botId: string; form: FormsProForm; onOpenChange: (open: boolean) => void }) {
  const t = useT("botFormsPro");
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useFormsProSubmissions(botId, form.id, search);
  const submissions = data?.submissions ?? [];
  const questions = data?.form.questions ?? form.questions;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.responsesTitle.replace("{name}", form.title)}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-8"
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" asChild>
            <a
              href={`/api/bots/${botId}/formspro/forms/${form.id}/submissions?search=${encodeURIComponent(search)}&format=csv`}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="me-1.5 size-4" /> {t.exportCsv}
            </a>
          </Button>
        </div>

        <div className="max-h-96 space-y-3 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t.loading}
            </div>
          ) : error ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{apiErrorMessage(error, t.errorGeneric)}</p>
          ) : submissions.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t.noResponses}</p>
          ) : (
            submissions.map((s) => (
              <div key={s.id} className="rounded-md border p-3 text-sm">
                <div className="mb-1.5 font-medium">
                  {s.username ? `@${s.username}` : s.user_id}
                </div>
                <dl className="space-y-1">
                  {questions.map((q, i) => (
                    <div key={q.id}>
                      <dt className="text-xs text-muted-foreground">{q.label}</dt>
                      <dd>{s.answers?.[i] || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FormsProResponses({ botId }: { botId: string }) {
  const t = useT("botFormsPro");
  const { data, isLoading, error } = useFormsProForms(botId);
  const [openForm, setOpenForm] = useState<FormsProForm | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }

  if (error || !data) {
    const code = apiErrorCode(error);
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {code === "no_sheet" ? t.noSheetYet : apiErrorMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const forms = data.forms ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.sectionDesc}</p>

      {forms.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noForms}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-start font-medium">{t.colTitle}</th>
                <th className="p-2 text-start font-medium">{t.colQuestions}</th>
                <th className="p-2 text-start font-medium">{t.colSubmissions}</th>
                <th className="p-2 text-start font-medium">{t.colStatus}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => (
                <tr key={form.id} className="border-t">
                  <td className="p-2 font-medium">{form.title}</td>
                  <td className="p-2 tabular-nums">{form.question_count}</td>
                  <td className="p-2 tabular-nums">{form.submission_count}</td>
                  <td className="p-2">
                    <Badge variant={form.is_open ? "default" : "secondary"}>
                      {form.is_open ? t.statusOpen : t.statusClosed}
                    </Badge>
                  </td>
                  <td className="p-2 text-end">
                    <Button variant="outline" size="sm" onClick={() => setOpenForm(form)}>
                      <MessageSquareText className="me-1.5 size-3.5" /> {t.viewResponsesCta}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openForm && (
        <ResponsesDialog botId={botId} form={openForm} onOpenChange={(open) => !open && setOpenForm(null)} />
      )}
    </div>
  );
}
