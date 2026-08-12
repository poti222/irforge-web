/**
 * PanelTree.tsx — نمای درختی پنل‌ها با collapse/expand و بج‌های وضعیت.
 *
 * درخت از `parent_id` ساخته می‌شود (سرور این کار را می‌کند)، نه از `children`
 * که می‌تواند کهنه باشد. پنلی که والدش وجود ندارد هم به‌عنوان ریشه دیده می‌شود
 * تا از چشم کاربر گم نشود.
 */
import { useState } from "react";
import { ChevronDown, ChevronLeft, Home, Ban, Lock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/use-translation";
import { useLanguage } from "@/hooks/use-language";
import type { PanelNode } from "./api";

function PanelRow({
  node,
  selectedId,
  onSelect,
  expanded,
  toggle,
}: {
  node: PanelNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const t = useT("botPanels");
  const { lang } = useLanguage();
  const rtl = lang === "fa" || lang === "ar";
  const hasChildren = node.childNodes.length > 0;
  const isOpen = expanded.has(node.id);
  const Chevron = isOpen ? ChevronDown : rtl ? ChevronLeft : ChevronLeft;
  const hasPassword = Boolean(node.settings?.password);

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
          selectedId === node.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
        }`}
        // تورفتگی با padding منطقی تا در RTL هم از سمت درست باشد.
        style={{ paddingInlineStart: `${node.depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={isOpen ? t.collapse : t.expand}
            aria-expanded={isOpen}
            className="shrink-0 rounded p-0.5 hover:bg-muted-foreground/10"
          >
            <Chevron className={`size-3.5 ${isOpen ? "" : "rtl-flip"}`} />
          </button>
        ) : (
          <span className="inline-block size-4 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.title || t.untitledPanel}</span>
          {node.is_home && <Home className="size-3.5 shrink-0 text-emerald-500" aria-label={t.badgeHome} />}
          {!node.is_active && <Ban className="size-3.5 shrink-0 text-destructive" aria-label={t.badgeInactive} />}
          {hasPassword && <Lock className="size-3.5 shrink-0 text-amber-500" aria-label={t.badgeLocked} />}
          <Badge variant="outline" className="ms-auto shrink-0 text-[10px]">
            {node.type}
          </Badge>
        </button>
      </div>

      {hasChildren && isOpen && (
        <ul>
          {node.childNodes.map((child) => (
            <PanelRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function PanelTree({
  tree,
  selectedId,
  onSelect,
}: {
  tree: PanelNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT("botPanels");
  // پیش‌فرض: همه باز. یک درخت جمع‌شده در اولین نگاه هیچ اطلاعاتی نمی‌دهد.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allIds = new Set<string>();
  const walk = (nodes: PanelNode[]) => {
    for (const n of nodes) {
      allIds.add(n.id);
      walk(n.childNodes);
    }
  };
  walk(tree);
  const expanded = new Set([...allIds].filter((id) => !collapsed.has(id)));

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (tree.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t.noPanels}
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <PanelRow
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
          expanded={expanded}
          toggle={toggle}
        />
      ))}
    </ul>
  );
}
