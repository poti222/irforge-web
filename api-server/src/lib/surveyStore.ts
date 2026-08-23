/**
 * lib/surveyStore.ts — IRFORGE_PROMPT_V3 Phase 20
 * ─────────────────────────────────────────────────────────────────────────────
 * Website-side data layer for the `survey` plugin, mirroring
 * `plugins/survey/domain.py` field-for-field. A dedicated store — not the
 * generic `pluginCollections.ts` system — because the old generic `surveys`
 * collection only ever exposed the survey's metadata (title/is_quiz/
 * is_active/…): it had no field for `questions` at all, so a survey created
 * from the site could never actually be published (the bot refuses to
 * publish a survey with zero questions). This store adds real question
 * authoring: add/update/remove, matching the Python side's own invariant
 * that a question's `id` is a sequential integer that is never reused or
 * shifted, so existing responses always stay meaningfully keyed even after
 * a later question is deleted.
 *
 * Editing an existing question's text/options in place (keeping its id) is
 * new here — `plugins/survey/domain.py` only exposes add/remove because
 * building an inline editor inside a Telegram FSM wizard is impractical,
 * not because the underlying data model forbids it. The website is exactly
 * where richer question editing belongs, same reasoning as `dripStore.ts`'s
 * fuller campaign editor versus the bot's simple wizard.
 *
 * End users only ever answer a survey through the bot — there is no
 * website-facing submit flow, so this store never writes to
 * `survey_responses`; it only reads responses for the results view.
 */
import {
  getEntity, putEntity, listEntity, removeEntity, assertSheetsAuthoritative, BotConfigError,
} from "./botConfig.js";
import { nowIso } from "./botTypes.js";
import { newRecordId } from "./pluginCollections.js";

const SURVEYS_TAB = "surveys";
const RESPONSES_TAB = "survey_responses";

export const Q_CHOICE = "choice";
export const Q_RATING = "rating";
export const Q_TEXT = "text";
export const QUESTION_TYPES = [Q_CHOICE, Q_RATING, Q_TEXT] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const MAX_QUESTIONS = 20;
export const MAX_OPTIONS = 8;

export interface SurveyQuestion {
  id: number;
  text: string;
  type: QuestionType;
  options: string[];
  correct?: number;
}

export interface Survey {
  id: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
  is_quiz: boolean;
  is_active: boolean;
  anonymous: boolean;
  response_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  user_id: string;
  username: string;
  answers: Record<string, unknown>;
  score: number;
  max_score: number;
  created_at?: string;
}

function bad(message: string, code?: string): BotConfigError {
  return new BotConfigError(400, message, code);
}

function questionsOf(survey: Survey): SurveyQuestion[] {
  return Array.isArray(survey.questions) ? survey.questions : [];
}

// ══════════════════════════════════════════════════════════════════════════
//  تعریف
// ══════════════════════════════════════════════════════════════════════════

export async function listSurveys(spreadsheetId: string): Promise<Survey[]> {
  const rows = await listEntity<Survey>(spreadsheetId, SURVEYS_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object")
    .map((r) => ({ ...(r.value as Survey), id: r.key }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export async function getSurvey(spreadsheetId: string, id: string): Promise<Survey | null> {
  const value = await getEntity<Survey>(spreadsheetId, SURVEYS_TAB, id);
  return value ? { ...value, id } : null;
}

export async function createSurvey(spreadsheetId: string, body: any): Promise<Survey> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const title = String(body?.title ?? "").trim();
  if (!title) throw bad("عنوان نظرسنجی نمی‌تواند خالی باشد.", "bad_title");

  const id = newRecordId("sv");
  const survey: Survey = {
    id,
    title: title.slice(0, 100),
    description: String(body?.description ?? "").trim().slice(0, 500),
    questions: [],
    is_quiz: Boolean(body?.is_quiz),
    is_active: false, // تا سؤال نداشته باشد منتشر نمی‌شود
    anonymous: Boolean(body?.anonymous),
    response_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, SURVEYS_TAB, id, survey);
  return survey;
}

export async function updateSurvey(spreadsheetId: string, id: string, body: any): Promise<Survey> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const existing = await getSurvey(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این نظرسنجی پیدا نشد.", "survey_not_found");

  const next: Survey = { ...existing, updated_at: nowIso() };
  if (body?.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) throw bad("عنوان نظرسنجی نمی‌تواند خالی باشد.", "bad_title");
    next.title = title.slice(0, 100);
  }
  if (body?.description !== undefined) next.description = String(body.description).trim().slice(0, 500);
  if (body?.is_quiz !== undefined) next.is_quiz = Boolean(body.is_quiz);
  if (body?.anonymous !== undefined) next.anonymous = Boolean(body.anonymous);

  await putEntity(spreadsheetId, SURVEYS_TAB, id, next);
  return next;
}

/** همون قراردادِ `plugins/survey/domain.py::set_active`: بدون سؤال منتشر نمی‌شود. */
export async function setActive(spreadsheetId: string, id: string, active: boolean): Promise<Survey> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const existing = await getSurvey(spreadsheetId, id);
  if (!existing) throw new BotConfigError(404, "این نظرسنجی پیدا نشد.", "survey_not_found");
  if (active && questionsOf(existing).length === 0)
    throw bad("این نظرسنجی هیچ سؤالی ندارد.", "no_questions");

  const next: Survey = { ...existing, is_active: active, updated_at: nowIso() };
  await putEntity(spreadsheetId, SURVEYS_TAB, id, next);
  return next;
}

export async function deleteSurvey(spreadsheetId: string, id: string): Promise<boolean> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const rows = await listEntity<SurveyResponse>(spreadsheetId, RESPONSES_TAB);
  for (const row of rows) {
    if (row.value && (row.value as SurveyResponse).survey_id === id) {
      await removeEntity(spreadsheetId, RESPONSES_TAB, row.key);
    }
  }
  return removeEntity(spreadsheetId, SURVEYS_TAB, id);
}

// ══════════════════════════════════════════════════════════════════════════
//  سؤال‌ها
// ══════════════════════════════════════════════════════════════════════════

function parseQuestionInput(survey: Survey, body: any): SurveyQuestion {
  const text = String(body?.text ?? "").trim();
  if (!text) throw bad("متن سؤال نمی‌تواند خالی باشد.", "bad_text");

  const type = body?.type as QuestionType;
  if (!QUESTION_TYPES.includes(type)) throw bad("نوع سؤال معتبر نیست.", "bad_type");

  const options = Array.isArray(body?.options)
    ? [...new Set(body.options.map((o: any) => String(o).trim()).filter(Boolean))].slice(0, MAX_OPTIONS)
    : [];
  if (type === Q_CHOICE && options.length < 2)
    throw bad("سؤال چندگزینه‌ای باید حداقل دو گزینه داشته باشد.", "not_enough_options");

  const question: SurveyQuestion = { id: 0, text: text.slice(0, 300), type, options: options as string[] };
  if (survey.is_quiz && type === Q_CHOICE && body?.correct_index !== undefined && body.correct_index !== null) {
    const idx = Number(body.correct_index);
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length) question.correct = idx;
  }
  return question;
}

export async function addQuestion(spreadsheetId: string, surveyId: string, body: any): Promise<Survey> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const survey = await getSurvey(spreadsheetId, surveyId);
  if (!survey) throw new BotConfigError(404, "این نظرسنجی پیدا نشد.", "survey_not_found");

  const questions = questionsOf(survey);
  if (questions.length >= MAX_QUESTIONS) throw bad(`حداکثر ${MAX_QUESTIONS} سؤال در هر نظرسنجی مجاز است.`, "max_questions");

  const question = parseQuestionInput(survey, body);
  const nextId = questions.reduce((max, q) => Math.max(max, Number(q.id) || 0), 0) + 1;
  question.id = nextId;

  const next: Survey = { ...survey, questions: [...questions, question], updated_at: nowIso() };
  await putEntity(spreadsheetId, SURVEYS_TAB, surveyId, next);
  return next;
}

/** ویرایشِ درجا — همان id، فقط متن/گزینه‌ها/جوابِ درست تغییر می‌کند. */
export async function updateQuestion(
  spreadsheetId: string, surveyId: string, questionId: number, body: any
): Promise<Survey> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const survey = await getSurvey(spreadsheetId, surveyId);
  if (!survey) throw new BotConfigError(404, "این نظرسنجی پیدا نشد.", "survey_not_found");

  const questions = questionsOf(survey);
  const index = questions.findIndex((q) => Number(q.id) === Number(questionId));
  if (index === -1) throw new BotConfigError(404, "این سؤال پیدا نشد.", "question_not_found");

  const parsed = parseQuestionInput(survey, { ...questions[index], ...body });
  parsed.id = questions[index].id;

  const nextQuestions = [...questions];
  nextQuestions[index] = parsed;
  const next: Survey = { ...survey, questions: nextQuestions, updated_at: nowIso() };
  await putEntity(spreadsheetId, SURVEYS_TAB, surveyId, next);
  return next;
}

/** حذفِ سؤال — id ها هرگز جابه‌جا/دوباره‌استفاده نمی‌شوند؛ بدون سؤال، منتشر هم نمی‌ماند. */
export async function removeQuestion(spreadsheetId: string, surveyId: string, questionId: number): Promise<Survey> {
  await assertSheetsAuthoritative(SURVEYS_TAB);
  const survey = await getSurvey(spreadsheetId, surveyId);
  if (!survey) throw new BotConfigError(404, "این نظرسنجی پیدا نشد.", "survey_not_found");

  const questions = questionsOf(survey).filter((q) => Number(q.id) !== Number(questionId));
  const next: Survey = {
    ...survey,
    questions,
    is_active: questions.length === 0 ? false : survey.is_active,
    updated_at: nowIso(),
  };
  await putEntity(spreadsheetId, SURVEYS_TAB, surveyId, next);
  return next;
}

// ══════════════════════════════════════════════════════════════════════════
//  پاسخ‌ها و تجمیع — فقط خواندن؛ ثبتِ پاسخ کارِ بات است
// ══════════════════════════════════════════════════════════════════════════

export async function listResponses(spreadsheetId: string, surveyId: string): Promise<SurveyResponse[]> {
  const rows = await listEntity<SurveyResponse>(spreadsheetId, RESPONSES_TAB);
  return rows
    .filter((r) => r.value && typeof r.value === "object" && (r.value as SurveyResponse).survey_id === surveyId)
    .map((r) => ({ ...(r.value as SurveyResponse), id: r.key }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export interface QuestionSummary {
  question: string;
  type: QuestionType;
  answered: number;
  options?: Array<{ option: string; count: number; percent: number; correct: boolean }>;
  average?: number;
  samples?: string[];
}

/** آینه‌ی `plugins/survey/domain.py::results()`. */
export async function getResults(spreadsheetId: string, surveyId: string): Promise<QuestionSummary[]> {
  const survey = await getSurvey(spreadsheetId, surveyId);
  if (!survey) return [];
  const responses = await listResponses(spreadsheetId, surveyId);

  return questionsOf(survey).map((question) => {
    const qid = String(question.id);
    const given = responses
      .map((r) => (r.answers && typeof r.answers === "object" ? (r.answers as Record<string, unknown>)[qid] : undefined))
      .filter((g) => g !== undefined && g !== null && g !== "");

    const summary: QuestionSummary = { question: question.text, type: question.type, answered: given.length };

    if (question.type === Q_CHOICE) {
      summary.options = (question.options || []).map((option, index) => {
        const hits = given.filter((g) => String(g) === String(index)).length;
        return {
          option,
          count: hits,
          percent: given.length ? Math.round((hits * 1000) / given.length) / 10 : 0,
          correct: question.correct === index,
        };
      });
    } else if (question.type === Q_RATING) {
      const numbers = given.map((g) => Number(g)).filter((n) => Number.isFinite(n));
      summary.average = numbers.length ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100 : 0;
    } else {
      summary.samples = given.slice(0, 5).map((g) => String(g).slice(0, 120));
    }

    return summary;
  });
}

export interface SurveyStats {
  total: number;
  active: number;
  responses: number;
}

export async function getStats(spreadsheetId: string): Promise<SurveyStats> {
  const surveys = await listSurveys(spreadsheetId);
  const rows = await listEntity<SurveyResponse>(spreadsheetId, RESPONSES_TAB);
  return {
    total: surveys.length,
    active: surveys.filter((s) => s.is_active && questionsOf(s).length > 0).length,
    responses: rows.filter((r) => r.value && typeof r.value === "object").length,
  };
}
