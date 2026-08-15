/**
 * AdminsSection.tsx — ادمین‌های بات و نقش‌ها (فاز ۱۳).
 *
 * افزودن ادمین با **یوزرنیم یا آی‌دی عددی** (باگ B10): در بات فقط یوزرنیم
 * پذیرفته می‌شود و به `getChat` وابسته است، پس اگر کاربر بات را استارت نکرده
 * باشد شکست می‌خورد — با خطای مبهم. اینجا هر دو قبول می‌شوند و اگر resolve
 * نشد، پیام دقیقاً می‌گوید چه کاری از کاربر برمی‌آید.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Bot } from "@workspace/api-client-react";
import { Plus, Loader2, Trash2, ShieldCheck, UserPlus, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/use-translation";
import { useToast } from "@/hooks/use-toast";

type BotAdmin = {
  user_id: string;
  username: string;
  role_id: string | null;
  extra_permissions: string[];
  denied_permissions: string[];
  is_super_admin: boolean;
  added_at: string;
  added_by: string;
  fullAccess: boolean;
};

type BotRole = { id: string; name: string; permissions: string[]; created_at: string; assignedCount: number };
type PermissionGroups = { core: Record<string, string[]>; discovered: string[] };

function errMessage(err: any, fallback: string): string {
  return err?.data?.error ?? err?.message ?? fallback;
}
function errCode(err: any): string | null {
  return err?.data?.code ?? null;
}

export function AdminsSection({ bot }: { bot: Bot }) {
  const t = useT("botAdmins");
  const { toast } = useToast();
  const qc = useQueryClient();
  const botId = bot.id;

  const adminsQuery = useQuery({
    queryKey: ["bot-admins", botId],
    queryFn: () => customFetch<{ admins: BotAdmin[]; count: number }>(`/api/bots/${botId}/bot-admins`),
  });
  const rolesQuery = useQuery({
    queryKey: ["bot-roles", botId],
    queryFn: () => customFetch<{ roles: BotRole[] }>(`/api/bots/${botId}/roles`),
  });
  const groupsQuery = useQuery({
    queryKey: ["bot-permission-groups", botId],
    queryFn: () => customFetch<PermissionGroups>(`/api/bots/${botId}/permission-groups`),
    staleTime: 5 * 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bot-admins", botId] });
    qc.invalidateQueries({ queryKey: ["bot-roles", botId] });
  };

  const addAdmin = useMutation({
    mutationFn: (body: { identifier: string; role_id: string | null; is_super_admin: boolean }) =>
      customFetch<{ admin: BotAdmin }>(`/api/bots/${botId}/bot-admins`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });
  const patchAdmin = useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: Partial<BotAdmin> }) =>
      customFetch(`/api/bots/${botId}/bot-admins/${userId}/permissions`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
  const removeAdmin = useMutation({
    mutationFn: (userId: string) =>
      customFetch(`/api/bots/${botId}/bot-admins/${userId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const saveRole = useMutation({
    mutationFn: ({ roleId, body }: { roleId: string | null; body: { name: string; permissions: string[] } }) =>
      customFetch<{ role: BotRole }>(
        roleId ? `/api/bots/${botId}/roles/${roleId}` : `/api/bots/${botId}/roles`,
        { method: roleId ? "PATCH" : "POST", body: JSON.stringify(body) }
      ),
    onSuccess: invalidate,
  });
  const removeRole = useMutation({
    mutationFn: ({ roleId, reassignTo }: { roleId: string; reassignTo: string | null }) =>
      customFetch(`/api/bots/${botId}/roles/${roleId}`, {
        method: "DELETE",
        body: JSON.stringify({ reassignTo }),
      }),
    onSuccess: invalidate,
  });

  const [tab, setTab] = useState<"admins" | "roles">("admins");
  const [addOpen, setAddOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [addErrorCode, setAddErrorCode] = useState<string | null>(null);
  const [newAdminRole, setNewAdminRole] = useState<string>("__none__");
  const [newAdminSuper, setNewAdminSuper] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [roleDialog, setRoleDialog] = useState<{ id: string | null; name: string; permissions: string[] } | null>(null);
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<BotRole | null>(null);
  const [reassignTo, setReassignTo] = useState("__none__");

  if (adminsQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t.loading}
      </div>
    );
  }
  if (adminsQuery.error || !adminsQuery.data) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {errCode(adminsQuery.error) === "no_sheet" ? t.noSheetYet : errMessage(adminsQuery.error, t.errorGeneric)}
      </div>
    );
  }

  const admins = adminsQuery.data.admins;
  const roles = rolesQuery.data?.roles ?? [];
  const groups = groupsQuery.data;
  const allGroups = [
    ...Object.keys(groups?.core ?? {}),
    ...(groups?.discovered ?? []),
  ];

  function groupLabel(group: string): string {
    const key = `group_${group}` as keyof typeof t;
    const label = t[key];
    return typeof label === "string" ? label : group;
  }

  /** دسترسی‌های یک گروه، برای چک‌باکس‌های نقش. */
  function groupPermissions(group: string): string[] {
    return groups?.core[group] ?? [`${group}.*`];
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "admins" | "roles")}>
        <TabsList>
          <TabsTrigger value="admins">{t.tabAdmins}</TabsTrigger>
          <TabsTrigger value="roles">{t.tabRoles}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "admins" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t.adminsDesc}</p>
            <Button onClick={() => { setIdentifier(""); setNewAdminRole("__none__"); setNewAdminSuper(false); setAddError(null); setAddOpen(true); }}>
              <UserPlus className="me-1.5 size-4" /> {t.addAdminCta}
            </Button>
          </div>

          {admins.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noAdmins}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-start font-medium">{t.colUser}</th>
                    <th className="p-2 text-start font-medium">{t.colRole}</th>
                    <th className="p-2 text-start font-medium">{t.colAccess}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {admins.map((admin) => (
                    <tr key={admin.user_id} className="border-t">
                      <td className="p-2">
                        <div className="min-w-0">
                          <div dir="ltr" className="truncate font-mono text-xs">{admin.user_id}</div>
                          {admin.username && <div dir="ltr" className="truncate text-xs text-muted-foreground">@{admin.username}</div>}
                        </div>
                      </td>
                      <td className="p-2">
                        <Select
                          value={admin.role_id ?? "__none__"}
                          onValueChange={(v) =>
                            patchAdmin.mutate(
                              { userId: admin.user_id, patch: { role_id: v === "__none__" ? null : v } as any },
                              {
                                onSuccess: () => toast({ title: t.adminUpdated }),
                                onError: (err: any) =>
                                  toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                              }
                            )
                          }
                        >
                          <SelectTrigger className="w-auto min-w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t.noRole}</SelectItem>
                            {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        {admin.fullAccess ? (
                          <Badge><ShieldCheck className="me-1 size-3" />{t.fullAccess}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {t.limitedAccess.replace("{n}", String(admin.extra_permissions.length))}
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 text-end">
                        <Button
                          variant="ghost" size="icon" aria-label={t.removeAdmin}
                          disabled={removeAdmin.isPending}
                          onClick={() =>
                            removeAdmin.mutate(admin.user_id, {
                              onSuccess: () => toast({ title: t.adminRemoved }),
                              onError: (err: any) =>
                                toast({
                                  variant: "destructive",
                                  title: errCode(err) === "last_super_admin" ? t.lastSuperAdminTitle : t.errorGeneric,
                                  description: errMessage(err, t.errorGeneric),
                                }),
                            })
                          }
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.lastSuperAdminHint}</span>
          </p>
        </div>
      )}

      {tab === "roles" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t.rolesDesc}</p>
            <Button onClick={() => setRoleDialog({ id: null, name: "", permissions: [] })}>
              <Plus className="me-1.5 size-4" /> {t.addRoleCta}
            </Button>
          </div>

          {roles.length === 0 ? (
            <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t.noRoles}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {roles.map((role) => (
                <Card key={role.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {role.name}
                      <Badge variant="outline">{t.assignedCount.replace("{n}", String(role.assignedCount))}</Badge>
                    </CardTitle>
                    <CardDescription>
                      {role.permissions.includes("*")
                        ? t.fullAccess
                        : t.permissionCount.replace("{n}", String(role.permissions.length))}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex gap-2">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setRoleDialog({ id: role.id, name: role.name, permissions: role.permissions })}
                    >
                      {t.editRole}
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => { setDeleteRoleTarget(role); setReassignTo("__none__"); }}
                    >
                      <Trash2 className="me-1.5 size-4 text-destructive" /> {t.deleteRole}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* افزودن ادمین — یوزرنیم یا آی‌دی عددی (باگ B10) */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.addAdminTitle}</DialogTitle>
            <DialogDescription>{t.addAdminDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-id">{t.fieldIdentifier}</Label>
              <Input
                id="admin-id" dir="ltr"
                placeholder="@username یا 123456789"
                value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setAddError(null); setAddErrorCode(null); }}
              />
              <p className="text-xs text-muted-foreground">{t.fieldIdentifierHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-role">{t.fieldRole}</Label>
              <Select value={newAdminRole} onValueChange={setNewAdminRole}>
                <SelectTrigger id="admin-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.noRole}</SelectItem>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox checked={newAdminSuper} onCheckedChange={(v) => setNewAdminSuper(Boolean(v))} />
              <span>{t.fieldSuperAdmin}</span>
            </label>
            {/* «کاربر بات را استارت نکرده» یک محدودیت خودِ تلگرام است، نه
                ورودی غلط کاربر — پس قرمزِ خطا نمی‌گیرد، چون کاربر را دنبال
                اصلاح یوزرنیمی می‌فرستد که هیچ ایرادی ندارد. */}
            {addError && (
              addErrorCode === "username_unresolvable" ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <span>{addError}</span>
                </div>
              ) : (
                <p className="text-sm text-destructive">{addError}</p>
              )
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={!identifier.trim() || addAdmin.isPending}
              onClick={() =>
                addAdmin.mutate(
                  {
                    identifier: identifier.trim(),
                    role_id: newAdminRole === "__none__" ? null : newAdminRole,
                    is_super_admin: newAdminSuper,
                  },
                  {
                    onSuccess: () => { toast({ title: t.adminAdded }); setAddOpen(false); },
                    onError: (err: any) => {
                      setAddError(errMessage(err, t.errorGeneric));
                      setAddErrorCode(errCode(err));
                    },
                  }
                )
              }
            >
              {addAdmin.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.addAdminCta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ساخت/ویرایش نقش */}
      <Dialog open={roleDialog !== null} onOpenChange={(open) => !open && setRoleDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{roleDialog?.id ? t.editRoleTitle : t.addRoleTitle}</DialogTitle>
            <DialogDescription>{t.roleDialogDesc}</DialogDescription>
          </DialogHeader>
          {roleDialog && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">{t.fieldRoleName}</Label>
                <Input
                  id="role-name"
                  value={roleDialog.name}
                  onChange={(e) => setRoleDialog({ ...roleDialog, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.fieldPermissions}</Label>
                {allGroups.map((group) => {
                  const perms = group === "all" ? ["*"] : groupPermissions(group);
                  const checked = perms.every((p) => roleDialog.permissions.includes(p));
                  return (
                    <label key={group} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          const on = Boolean(v);
                          const without = roleDialog.permissions.filter((p) => !perms.includes(p));
                          setRoleDialog({ ...roleDialog, permissions: on ? [...without, ...perms] : without });
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block">{groupLabel(group)}</span>
                        <span dir="ltr" className="block truncate font-mono text-xs text-muted-foreground">
                          {perms.join(" ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={!roleDialog?.name.trim() || saveRole.isPending}
              onClick={() =>
                roleDialog &&
                saveRole.mutate(
                  { roleId: roleDialog.id, body: { name: roleDialog.name.trim(), permissions: roleDialog.permissions } },
                  {
                    onSuccess: () => { toast({ title: t.roleSaved }); setRoleDialog(null); },
                    onError: (err: any) =>
                      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                  }
                )
              }
            >
              {saveRole.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* حذف نقش — با جابه‌جایی ادمین‌های اختصاص‌یافته */}
      <Dialog open={deleteRoleTarget !== null} onOpenChange={(open) => !open && setDeleteRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteRoleTitle.replace("{name}", deleteRoleTarget?.name ?? "")}</DialogTitle>
            <DialogDescription>
              {(deleteRoleTarget?.assignedCount ?? 0) > 0
                ? t.deleteRoleAssigned.replace("{n}", String(deleteRoleTarget?.assignedCount ?? 0))
                : t.deleteRoleFree}
            </DialogDescription>
          </DialogHeader>
          {(deleteRoleTarget?.assignedCount ?? 0) > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="reassign">{t.reassignLabel}</Label>
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger id="reassign"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.reassignNone}</SelectItem>
                  {roles.filter((r) => r.id !== deleteRoleTarget?.id).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={removeRole.isPending}
              onClick={() =>
                deleteRoleTarget &&
                removeRole.mutate(
                  { roleId: deleteRoleTarget.id, reassignTo: reassignTo === "__none__" ? null : reassignTo },
                  {
                    onSuccess: () => { toast({ title: t.roleDeleted }); setDeleteRoleTarget(null); },
                    onError: (err: any) =>
                      toast({ variant: "destructive", title: t.errorGeneric, description: errMessage(err, t.errorGeneric) }),
                  }
                )
              }
            >
              {removeRole.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
              {t.deleteRole}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
