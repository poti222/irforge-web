import {
  useAdminListUsers,
  useAdminUpdateUser,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminUser, AdminUserUpdateRole,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { getRowHaloClass } from "@/lib/user-halo";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  suspended: "secondary",
  banned: "destructive",
};

export function UsersTable() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const isSuperAdmin = me?.role === "super_admin";

  const { data: users, isLoading } = useAdminListUsers();
  const updateUser = useAdminUpdateUser();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });

  function changeRole(u: AdminUser, role: AdminUserUpdateRole) {
    updateUser.mutate(
      { userId: u.id, data: { role } },
      {
        onSuccess: () => { invalidate(); toast({ title: fa ? "نقش تغییر کرد" : "Role updated" }); },
        onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message }),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{fa ? "کاربر" : "User"}</TableHead>
            <TableHead>{fa ? "نقش" : "Role"}</TableHead>
            <TableHead>{fa ? "وضعیت" : "Status"}</TableHead>
            <TableHead className="hidden md:table-cell">{fa ? "ربات‌ها" : "Bots"}</TableHead>
            <TableHead className="hidden lg:table-cell">{fa ? "تاریخ ثبت" : "Joined"}</TableHead>
            {isSuperAdmin && <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(users ?? []).map((u) => {
            const isSelf = u.id === me?.id;
            return (
              <TableRow key={u.id} className={cn(getRowHaloClass(u))}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{u.name}</span>
                    {u.flaggedForReview && (
                      <span title={u.flagReason ?? (fa ? "علامت‌خورده برای بازبینی" : "Flagged for review")}>
                        <Flag
                          className="size-3.5 shrink-0 text-amber-500"
                          aria-label={fa ? "علامت‌خورده برای بازبینی" : "Flagged for review"}
                        />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onValueChange={(v) => changeRole(u, v as AdminUserUpdateRole)}
                    disabled={isSelf || updateUser.isPending}
                  >
                    <SelectTrigger className="h-8 w-[104px] sm:w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">user</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                      {/* X3: only a super_admin may grant super_admin */}
                      {(isSuperAdmin || u.role === "super_admin") && (
                        <SelectItem value="super_admin">super_admin</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {/* فقط‌خواندنی — تغییرِ وضعیت (تعلیق/مسدودی) و حذفِ حساب
                      دیگر فقط از صفحه‌ی «مدیریت کاربران» (سوپرادمین) ممکن
                      است، نه از همین‌جا. */}
                  <Badge variant={STATUS_VARIANT[u.status] ?? "outline"}>{u.status}</Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">{u.botCount}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                </TableCell>
                {isSuperAdmin && (
                  <TableCell className="text-end">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {fa ? "مدیریت" : "Manage"}
                    </Link>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
