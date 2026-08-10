import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, ChevronRight, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/hooks/use-language";

/** فهرست کاربران برای super_admin — جست‌وجو، فیلتر و صفحه‌بندی. */
export default function AdminUsers() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-users", search, role, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), perPage: "25" });
      if (search) params.set("search", search);
      if (role !== "all") params.set("role", role);
      if (status !== "all") params.set("status", status);
      return customFetch<{ items: any[]; total: number; perPage: number }>(
        `/api/superadmin/users?${params}`,
      );
    },
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <h1 className="text-2xl font-bold tracking-tight">{fa ? "کاربران" : "Users"}</h1>

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="ps-9"
            placeholder={fa ? "نام، ایمیل، شماره یا یوزرنیم" : "Name, email, phone or username"}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label={fa ? "جست‌وجوی کاربران" : "Search users"}
          />
        </div>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{fa ? "همه‌ی نقش‌ها" : "All roles"}</SelectItem>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="super_admin">super_admin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{fa ? "همه‌ی وضعیت‌ها" : "All statuses"}</SelectItem>
            <SelectItem value="active">active</SelectItem>
            <SelectItem value="suspended">suspended</SelectItem>
            <SelectItem value="banned">banned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : isError ? (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-500">
            <AlertTriangle className="size-4" />
            {fa ? "خطا در بارگذاری کاربران" : "Failed to load users"}
          </CardContent>
        </Card>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-2">
            {data.items.map((u) => (
              <Link key={u.id} href={`/admin/users/${u.id}`} className="block">
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {[u.email, u.phone, u.telegramUsername && `@${u.telegramUsername}`]
                          .filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge variant="outline">{u.role}</Badge>
                    <Badge variant={u.status === "active" ? "secondary" : "destructive"}>{u.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {fa ? "ربات" : "bots"}: {u.botCount}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground rtl-flip" aria-hidden="true" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {fa ? "قبلی" : "Previous"}
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              {fa ? "بعدی" : "Next"}
            </Button>
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          {fa ? "کاربری پیدا نشد." : "No users found."}
        </p>
      )}
    </div>
  );
}
