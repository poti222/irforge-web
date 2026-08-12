/**
 * LanguageSection.tsx — زبان بات و جدول ترجمه‌ی رشته‌ها (فاز ۲۱).
 *
 * دو چیز که این صفحه صادقانه می‌گوید به‌جای اینکه پنهانشان کند:
 *  - هسته‌ی بات فقط `fa` و `en` را ثبت می‌کند. بقیه‌ی زبان‌ها قابل انتخاب‌اند
 *    ولی تا وقتی رشته‌هایشان وارد نشود، بات متن انگلیسی نشان می‌دهد.
 *  - رشته‌ها در تب‌های `text_keys`/`text_values` زندگی می‌کنند و lazy ساخته
 *    می‌شوند؛ خالی بودنشان یعنی «هنوز چیزی ثبت نشده»، نه خطا.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Loader2, Search, RotateCcw, Save, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type LanguageInfo = {
  language: string;
  coreLanguages: string[];
  otherLanguages: string[];
  fallbackLanguage: string;
};

type StringRow = { key: string; category: string; value: string; fallback: string };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function LanguageSection({ bot }: { bot: Bot }) {
  const t = useT("botLanguage");
  const { toast } = useToast();
  const qc = useQueryClient();

  const infoKey = ["bot-language", bot.id] as const;
  const { data: info, isLoading, error } = useQuery({
    queryKey: infoKey,
    queryFn: () => customFetch<LanguageInfo>(`/api/bots/${bot.id}/language`),
  });

  const [editingLang, setEditingLang] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const lang = editingLang ?? info?.language ?? "fa";

  const stringsKey = ["bot-language-strings", bot.id, lang, search] as const;
  const { data: strings, isFetching } = useQuery({
    queryKey: stringsKey,
    queryFn: () =>
      customFetch<{ strings: StringRow[]; total: number }>(
        `/api/bots/${bot.id}/language/strings?lang=${lang}&search=${encodeURIComponent(search)}`
      ),
    enabled: Boolean(info),
    placeholderData: keepPreviousData,
  });

  const setLanguage = useMutation({
    mutationFn: (next: string) =>
      customFetch<{ language: string; warning: string | null }>(`/api/bots/${bot.id}/language`, {
        method: "PUT",
        body: JSON.stringify({ language: next }),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: infoKey });
      toast(
        result.warning
          ? { title: t.languageSaved, description: result.warning }
          : { title: t.languageSaved }
      );
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const saveString = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      customFetch(`/api/bots/${bot.id}/language/strings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ lang, value }),
      }),
    onSuccess: (_r, variables) => {
      qc.invalidateQueries({ queryKey: ["bot-language-strings", bot.id] });
      setDrafts((p) => {
        const next = { ...p };
        delete next[variables.key];
        return next;
      });
      toast({ title: t.stringSaved });
    },
    onError: (err: any) =>
      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
  });

  const resetString = useMutation({
    mutationFn: (key: string) =>
      customFetch(`/api/bots/${bot.id}/language/strings/${encodeURIComponent(key)}?lang=${lang}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-language-strings", bot.id] });
      toast({ title: t.stringReset });
    },
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.loading}</div>;
  }
  if (error || !info) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(error) === "no_sheet" ? t.noSheetYet : errMessage(error, t.errorGeneric)}
      </div>
    );
  }

  const allLanguages = [...info.coreLanguages, ...info.otherLanguages];

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t.defaultLanguageTitle}</CardTitle>
          <CardDescription>{t.defaultLanguageDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="bot-lang">{t.defaultLanguage}</Label>
            <Select value={info.language} onValueChange={(v) => setLanguage.mutate(v)}>
              <SelectTrigger id="bot-lang" className="max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allLanguages.map((code) => (
                  <SelectItem key={code} value={code}>
                    {(t[`lang_${code}` as keyof typeof t] as string) ?? code}
                    {!info.coreLanguages.includes(code) ? ` — ${t.notInCore}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.coreLanguagesNotice.replace("{langs}", info.coreLanguages.join("، "))}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {t.stringsTitle}
            <Badge variant="outline">{t.stringCount.replace("{n}", String(strings?.total ?? 0))}</Badge>
          </CardTitle>
          <CardDescription>{t.stringsDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 ms-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-8" placeholder={t.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={lang} onValueChange={setEditingLang}>
              <SelectTrigger className="w-auto min-w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allLanguages.map((code) => (
                  <SelectItem key={code} value={code}>{(t[`lang_${code}` as keyof typeof t] as string) ?? code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {(strings?.strings.length ?? 0) === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {search ? t.noMatches : t.noStrings}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-start font-medium">{t.colKey}</th>
                    <th className="p-2 text-start font-medium">{t.colDefault}</th>
                    <th className="p-2 text-start font-medium">{t.colCustom}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {strings!.strings.map((row) => {
                    const draft = drafts[row.key];
                    const value = draft ?? row.value;
                    const dirty = draft !== undefined && draft !== row.value;
                    return (
                      <tr key={row.key} className="border-t align-top">
                        <td className="p-2">
                          <code dir="ltr" className="font-mono text-xs">{row.key}</code>
                          <div className="text-xs text-muted-foreground">{row.category}</div>
                        </td>
                        <td className="max-w-48 p-2 text-xs text-muted-foreground">{row.fallback}</td>
                        <td className="p-2">
                          <Input
                            value={value}
                            placeholder={row.fallback}
                            onChange={(e) => setDrafts((p) => ({ ...p, [row.key]: e.target.value }))}
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost" size="icon" aria-label={t.saveString}
                              disabled={!dirty || saveString.isPending}
                              onClick={() => saveString.mutate({ key: row.key, value })}
                            >
                              <Save className="size-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" aria-label={t.resetString}
                              disabled={!row.value || resetString.isPending}
                              onClick={() => resetString.mutate(row.key)}
                            >
                              <RotateCcw className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
