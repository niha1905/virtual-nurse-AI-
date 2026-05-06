import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "patient" | "caregiver" | "doctor";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  roles: [],
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const syncAuthState = async (sess: Session | null) => {
      setSession(sess);
      setUser(sess?.user ?? null);

      if (!sess?.user) {
        setRoles([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setRoles(getSeedRoles(sess.user));

      // Defer Supabase calls to avoid deadlock inside onAuthStateChange.
      setTimeout(() => {
        fetchRoles(sess.user.id).finally(() => setLoading(false));
      }, 0);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      void syncAuthState(sess);
    });

    supabase.auth.getSession().then(async ({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);

      if (!sess?.user) {
        setRoles([]);
        setLoading(false);
        return;
      }

      setRoles(getSeedRoles(sess.user));
      await fetchRoles(sess.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const fetchRoles = async (uid: string) => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);
    if (!error && data) setRoles(data.map((r) => r.role as AppRole));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
  };

  return (
    <Ctx.Provider value={{ user, session, roles, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);

const getSeedRoles = (user: User): AppRole[] => {
  const role = user.user_metadata?.role;
  if (role === "patient" || role === "caregiver" || role === "doctor") {
    return [role];
  }
  return [];
};
