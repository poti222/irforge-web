import React, { createContext, useContext } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { User, LoginInput, RegisterInput } from "@workspace/api-client-react";
import { useGetMe, getGetMeQueryKey, login as apiLogin, register as apiRegister, logout as apiLogout } from "@workspace/api-client-react";

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

  const { data: me, isLoading: isLoadingMe, refetch } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
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
      localStorage.setItem("irforge_token", result.token);
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
      localStorage.setItem("irforge_token", result.token);
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
      localStorage.removeItem("irforge_token");
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
