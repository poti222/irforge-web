import { UsersTable } from "@/components/admin/UsersTable";
import { useLanguage } from "@/hooks/use-language";

export default function AdminUsers() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        {fa ? "مدیریت کاربران" : "Manage Users"}
      </h1>
      <UsersTable />
    </div>
  );
}
