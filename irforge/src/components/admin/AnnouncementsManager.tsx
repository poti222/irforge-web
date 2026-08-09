import { useState } from "react";
import {
  useListAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  getListAnnouncementsQueryKey,
} from "@workspace/api-client-react";
import type { Announcement, AnnouncementInputType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Megaphone, Trash2, Loader2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";

const TYPES: AnnouncementInputType[] = ["info", "warning", "success", "error"];

/**
 * The API answers a rejected announcement with `{ error: "<reason>" }` and a
 * 400. `ApiError.message` prefixes that with "HTTP 400 Bad Request: ", which is
 * noise in a toast — prefer the raw server reason when there is one.
 */
function serverMessage(err: any): string | undefined {
  const reason = err?.data?.error;
  return typeof reason === "string" && reason.trim() !== "" ? reason : err?.message;
}

const TYPE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  info: "secondary",
  success: "default",
  warning: "outline",
  error: "destructive",
};

export function AnnouncementsManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useListAnnouncements();
  const createAnn = useCreateAnnouncement();
  const deleteAnn = useDeleteAnnouncement();

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<AnnouncementInputType>("info");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });

  function create() {
    if (!title.trim() || !message.trim()) {
      toast({ variant: "destructive", title: fa ? "عنوان و متن الزامی است" : "Title and message are required" });
      return;
    }
    createAnn.mutate(
      { data: { title: title.trim(), message: message.trim(), type } },
      {
        onSuccess: () => {
          invalidate();
          setTitle(""); setMessage(""); setType("info");
          toast({ title: fa ? "اعلان ساخته شد" : "Announcement created" });
        },
        onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) }),
      }
    );
  }

  function remove(a: Announcement) {
    deleteAnn.mutate(
      { announcementId: a.id },
      {
        onSuccess: () => { invalidate(); toast({ title: fa ? "اعلان حذف شد" : "Announcement deleted" }); },
        onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: serverMessage(err) }),
      }
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" /> {fa ? "اعلان جدید" : "New announcement"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">{fa ? "عنوان" : "Title"}</Label>
            <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann-msg">{fa ? "متن" : "Message"}</Label>
            <Textarea id="ann-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{fa ? "نوع" : "Type"}</Label>
            <Select value={type} onValueChange={(v) => setType(v as AnnouncementInputType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={create} disabled={createAnn.isPending}>
            {createAnn.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Plus className="me-2 h-4 w-4" />}
            {fa ? "انتشار" : "Publish"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {fa ? "اعلان‌های فعلی" : "Current announcements"}
        </h3>
        {isLoading ? (
          <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />)}</div>
        ) : items && items.length > 0 ? (
          items.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={TYPE_VARIANT[a.type] ?? "outline"}>{a.type}</Badge>
                    <span className="font-medium truncate">{a.title}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.message}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(a)} disabled={deleteAnn.isPending}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            {fa ? "اعلانی وجود ندارد." : "No announcements yet."}
          </p>
        )}
      </div>
    </div>
  );
}
