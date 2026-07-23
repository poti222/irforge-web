import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExternalLink, Bot as BotIcon } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

type AdminBot = Bot & { owner: { id: string; name: string; email: string } | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  inactive: "secondary",
  pending_payment: "outline",
  payment_rejected: "destructive",
  error: "destructive",
};

export function AllBotsTable() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const nf = (n: number | undefined) => (n ?? 0).toLocaleString(fa ? "fa-IR" : "en-US");

  const { data: bots, isLoading } = useQuery({
    queryKey: ["admin-bots"],
    queryFn: () => customFetch<AdminBot[]>("/api/admin/bots"),
  });

  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>;
  }

  if (!bots || bots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-12 text-center">
        <BotIcon className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{fa ? "هیچ باتی روی پلتفرم نیست." : "No bots on the platform yet."}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{fa ? "ربات" : "Bot"}</TableHead>
            <TableHead>{fa ? "مالک" : "Owner"}</TableHead>
            <TableHead>{fa ? "وضعیت" : "Status"}</TableHead>
            <TableHead className="hidden md:table-cell">{fa ? "کاربران" : "Users"}</TableHead>
            <TableHead className="hidden md:table-cell">{fa ? "پیام‌ها" : "Messages"}</TableHead>
            <TableHead className="hidden lg:table-cell">{fa ? "تاریخ" : "Created"}</TableHead>
            <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bots.map((bot) => (
            <TableRow key={bot.id}>
              <TableCell>
                <div className="font-medium">{bot.name}</div>
                {bot.username && <div className="text-xs text-muted-foreground">@{bot.username}</div>}
              </TableCell>
              <TableCell>
                {bot.owner ? (
                  <>
                    <div className="text-sm">{bot.owner.name}</div>
                    <div className="text-xs text-muted-foreground">{bot.owner.email}</div>
                  </>
                ) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell><Badge variant={STATUS_VARIANT[bot.status] ?? "outline"}>{bot.status}</Badge></TableCell>
              <TableCell className="hidden md:table-cell">{nf(bot.userCount)}</TableCell>
              <TableCell className="hidden md:table-cell">{nf(bot.messageCount)}</TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">
                {new Date(bot.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
              </TableCell>
              <TableCell className="text-end">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/bots/${bot.id}`}>
                    <ExternalLink className="me-1 h-3.5 w-3.5" /> {fa ? "باز کردن" : "Open"}
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
