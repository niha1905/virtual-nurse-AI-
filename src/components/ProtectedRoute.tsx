import { Navigate } from "react-router-dom";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: React.ReactNode;
  requireRoles?: AppRole[];
}

export const ProtectedRoute = ({ children, requireRoles }: Props) => {
  const { user, roles, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  if (requireRoles && requireRoles.length > 0) {
    const ok = requireRoles.some((r) => roles.includes(r));
    if (!ok) return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};
