import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

const DashboardRouter = () => {
  const { roles, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (roles.includes("doctor")) return <Navigate to="/doctor" replace />;
  if (roles.includes("caregiver")) return <Navigate to="/caregiver" replace />;
  return <Navigate to="/patient" replace />;
};

export default DashboardRouter;
