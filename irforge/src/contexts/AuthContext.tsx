import React, { createContext, useContext, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { User, LoginInput, RegisterInput } from "@workspace/api-client-react";
import { useGetMe, getGetMeQueryKey, login as apiLogin, register as apiRegister, logout as apiLogout } from "@workspace/api-client-react";
import {
  clearAuthToken,
  getAuthToken,
  getServerAuthToken,
  setAuthToken,
  subscribeAuthToken,
} from "@/lib/auth-token";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginInput) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // NOTE: an anonymous visitor has no token, so there is nothing for
  // GET /api/auth/me to answer — it used to fire anyway and come back 401 on
  // every single landing-page view. That is a wasted round-trip during the
  // page's busiest moment, and the browser logs the 401 itself (PageSpeed
  // reports it under "Browser errors were logged to the console"; no amount of
  // catching in JS suppresses it).
  //
  // `enabled` gates the request on actually having a session. react-query v5
  // reports isLoading = isPending && isFetching, so a disabled query is not
  // "loading" — ProtectedRoute sees (isLoading=false, user=null) immediately
  // and redirects to /login instead of hanging on a spinner.
  const token = useSyncExternalStore(subscribeAuthToken, getAuthToken, getServerAuthToken);

  const { data: me, isLoading: isLoadingMe, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      enabled: Boolean(token),
    }
  });

  // Derive `user` directly from the query cache instead of mirroring it into
  // local state via useEffect. The old approach had a one-render race: when the
  // /me query resolved, `isLoading` flipped to false a render BEFORE the effect
  // copied `me` into state, so ProtectedRoute briefly saw (isLoading=false,
  // user=null) and bounced a hard-loaded protected route through /login. With a
  // single source of truth (the cache) that window disappears. login/register/
  // logout write straight to the same cache key so everything stays consistent.
  const user = me ?? null;

  const login = async (data: LoginInput) => {
    try {
      const result = await apiLogin(data);
      setAuthToken(result.token);
      queryClient.setQueryData(getGetMeQueryKey(), result.user);
      setLocation("/dashboard");
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const register = async (data: RegisterInput) => {
    try {
      const result = await apiRegister(data);
      setAuthToken(result.token);
      queryClient.setQueryData(getGetMeQueryKey(), result.user);
      setLocation("/dashboard");
    } catch (error) {
      console.error(error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error(error);
    } finally {
      clearAuthToken();
      queryClient.setQueryData(getGetMeQueryKey(), null);
      setLocation("/login");
    }
  };

  const refreshUser = async () => {
    await refetch();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading: isLoadingMe, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
