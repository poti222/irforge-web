import { useIsFetching, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Deep-partial prefix match, mirroring how TanStack's `invalidateQueries`
 * matches a filter key against a query key: the filter matches when the query
 * key *starts with* every segment of the filter key. Object segments (the
 * generated client uses `[{ url, ... }]`-shaped keys) are compared structurally.
 */
function keyMatches(filterKey: readonly unknown[], queryKey: readonly unknown[]): boolean {
  if (filterKey.length > queryKey.length) return false;
  return filterKey.every((seg, i) => {
    const q = queryKey[i];
    if (seg === q) return true;
    if (typeof seg === "object" && seg !== null && typeof q === "object" && q !== null) {
      return JSON.stringify(seg) === JSON.stringify(q);
    }
    return false;
  });
}

export interface RefreshButtonProps {
  /** One or more query keys to invalidate and to watch for in-flight fetches. */
  queryKeys: QueryKey[];
  /** Accessible label / tooltip. Callers pass a localised string. */
  label?: string;
  className?: string;
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * A single reusable manual-refetch control. Pressing it invalidates every key
 * in `queryKeys`; the icon spins while *any* of those keys is fetching and the
 * button is disabled for the duration, so it can't be double-fired mid-flight.
 * The spinner is driven by `useIsFetching` (real query state) rather than local
 * state, so it also reflects background refetches it didn't start. The spin is
 * suppressed under `prefers-reduced-motion`.
 */
export function RefreshButton({ queryKeys, label, className, size = "icon" }: RefreshButtonProps) {
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const fetchingCount = useIsFetching({
    predicate: (query) => queryKeys.some((key) => keyMatches(key as unknown[], query.queryKey)),
  });
  const isFetching = fetchingCount > 0;

  const refresh = () => {
    if (isFetching) return;
    for (const key of queryKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={refresh}
      disabled={isFetching}
      aria-label={label ?? "Refresh"}
      title={label ?? "Refresh"}
      className={className}
    >
      <RefreshCw className={cn("size-4", isFetching && !reduce && "animate-spin")} />
    </Button>
  );
}
