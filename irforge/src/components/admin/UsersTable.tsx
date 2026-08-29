import { useState } from "react";
import {
  useAdminListUsers,
  useAdminUpdateUser,
  useAdminDeleteUser,
  getAdminListUsersQueryKey,
} from "@workspace/api-client-react";
import type {
  AdminUser, AdminUserUpdateRole, AdminUserUpdateStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Loader2, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  suspended: "secondary",
  banned: "destructive",
};

/**
 * هاله‌ی رنگیِ نقش/جنسیت — فاز ۵.
 *
 * اولویت: super_admin (مشکی، هرگز دست‌نخورده — «دست نزن برای سوپرها») >
 * admin (طلایی، حتی اگر آن ادمین male/female هم باشد) > جنسیت > هیچ‌کدام.
 * چون role دقیقاً یکی از این سه مقدار است، هیچ‌وقت دو تا از این سه با هم
 * برخورد نمی‌کنند — فقط جنسیت و نقش رقابت می‌کنند، که همان چیزی است که
 * ترتیب زیر حل می‌کند.
 *
 * فقط دسکتاپ: این جدول اصلاً نسخه‌ی کارتیِ موبایل ندارد (هیچ breakpointی
 * سوییچ نمی‌کند)، پس «دسکتاپ‌محور بودن» را با پیشوندِ ریسپانسیوِ خودِ کلاس
 * تأمین می‌کنیم — زیر `md` هیچ گرادیانی رنگ نمی‌شود.
 */
function getRowHaloClass(u: Pick<AdminUser, "role" | "gender">): string {
  if (u.role === "super_admin") return "md:[background:linear-gradient(to_right,rgba(0,0,0,0.35),transparent)]";
  if (u.role === "admin") return "md:[background:linear-gradient(to_right,rgba(234,179,8,0.35),transparent)]";
  if (u.gender === "male") return "md:[background:linear-gradient(to_right,rgba(96,165,250,0.35),transparent)]";
  if (u.gender === "female") return "md:[background:linear-gradient(to_right,rgba(244,114,182,0.35),transparent)]";
  return "";
}

export function UsersTable() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const isSuperAdmin = me?.role === "super_admin";

  const { data: users, isLoading } = useAdminListUsers();
  const updateUser = useAdminUpdateUser();
  const deleteUser = useAdminDeleteUser();
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

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

  function changeStatus(u: AdminUser, status: AdminUserUpdateStatus) {
    updateUser.mutate(
      { userId: u.id, data: { status } },
      {
        onSuccess: () => { invalidate(); toast({ title: fa ? "وضعیت تغییر کرد" : "Status updated" }); },
        onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message }),
      }
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    deleteUser.mutate(
      { userId: deleting.id },
      {
        onSuccess: () => { invalidate(); setDeleting(null); toast({ title: fa ? "کاربر حذف شد" : "User deleted" }); },
        onError: (err: any) => toast({ variant: "destructive", title: fa ? "خطا در حذف" : "Delete failed", description: err?.message }),
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
            <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
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
                  <Select
                    value={u.status}
                    onValueChange={(v) => changeStatus(u, v as AdminUserUpdateStatus)}
                    disabled={isSelf || updateUser.isPending}
                  >
                    <SelectTrigger className="h-8 w-[104px] sm:w-[130px]">
                      <SelectValue>
                        <Badge variant={STATUS_VARIANT[u.status] ?? "outline"}>{u.status}</Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="suspended">suspended</SelectItem>
                      <SelectItem value="banned">banned</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="hidden md:table-cell">{u.botCount}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString(fa ? "fa-IR" : "en-US")}
                </TableCell>
                <TableCell className="text-end">
                  <Button
                    variant="ghost" size="icon"
                    disabled={isSelf}
                    onClick={() => setDeleting(u)}
                    aria-label="delete user"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذف کاربر؟" : "Delete user?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa
                ? `کاربر «${deleting?.name}» (${deleting?.email}) برای همیشه حذف می‌شود.`
                : `“${deleting?.name}” (${deleting?.email}) will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUser.isPending}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleteUser.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteUser.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
