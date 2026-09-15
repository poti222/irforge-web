/**
 * lib/formsProStore.ts — IRFORGE_BOOKING_FORM_CONTACT_REFERRAL_PROMPT بخشِ ۲.
 *
 * سایت‌سمتِ فقط-خواندنِ پلاگینِ `forms_pro` (دستورِ /openforms روی بات —
 * فرم‌هایِ مستقل و آرشیوِ پاسخ‌ها، جدا از سیستمِ هسته‌ایِ فرم‌سازِ
 * `lib/botFormsTypes`ی موجود که داخلِ پنل‌ها تعبیه می‌شود). همتایِ دقیقِ
 * `plugins/forms_pro/domain.py` — همان دو تب، فقط خواندنی: ساختن/ویرایشِ
 * سؤال‌ها همچنان از کنسولِ ادمینِ بات است، سایت فقط آرشیوِ پاسخ‌ها را نشان
 * می‌دهد (طبقِ خودِ پرامپت: «نمایشِ آرشیو»، نه یک فرم‌سازِ دوم).
 */
import { listEntity } from "./botConfig.js";

const FORMS_TAB = "formspro_forms";
const SUBMISSIONS_TAB = "formspro_submissions";

export type FormsProQuestion = {
  id: number;
  label: string;
  options?: string[];
  allow_custom?: boolean;
};

export type FormsProForm = {
  id: string;
  title: string;
  questions: FormsProQuestion[];
  is_open: boolean;
  created_at?: string;
};

export type FormsProSubmission = {
  id: string;
  form_id: string;
  user_id: string;
  username?: string;
  answers: string[];
  created_at?: string;
};

export type FormsProFormSummary = FormsProForm & {
  question_count: number;
  submission_count: number;
};

export async function listForms(spreadsheetId: string): Promise<FormsProFormSummary[]> {
  const [formRows, submissionRows] = await Promise.all([
    listEntity<FormsProForm>(spreadsheetId, FORMS_TAB),
    listEntity<FormsProSubmission>(spreadsheetId, SUBMISSIONS_TAB),
  ]);

  const submissionCounts = new Map<string, number>();
  for (const row of submissionRows) {
    const formId = (row.value as FormsProSubmission)?.form_id;
    if (!formId) continue;
    submissionCounts.set(formId, (submissionCounts.get(formId) ?? 0) + 1);
  }

  return formRows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => {
      const form = { ...(r.value as FormsProForm), id: r.key };
      return {
        ...form,
        questions: form.questions ?? [],
        question_count: (form.questions ?? []).length,
        submission_count: submissionCounts.get(r.key) ?? 0,
      };
    })
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export async function getForm(spreadsheetId: string, formId: string): Promise<FormsProForm | null> {
  const forms = await listEntity<FormsProForm>(spreadsheetId, FORMS_TAB);
  const row = forms.find((r) => r.key === formId);
  if (!row || !row.value || typeof row.value !== "object") return null;
  return { ...(row.value as FormsProForm), id: formId };
}

export async function listSubmissions(
  spreadsheetId: string,
  formId: string,
  search = "",
): Promise<FormsProSubmission[]> {
  const rows = await listEntity<FormsProSubmission>(spreadsheetId, SUBMISSIONS_TAB);
  let submissions = rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as FormsProSubmission).form_id === formId)
    .map((r) => ({ ...(r.value as FormsProSubmission), id: r.key }));

  const needle = search.trim().toLowerCase();
  if (needle) {
    submissions = submissions.filter((s) =>
      [s.username, s.user_id, ...(s.answers ?? [])]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(needle)),
    );
  }

  submissions.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return submissions;
}
