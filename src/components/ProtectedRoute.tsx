import { Navigate } from 'react-router-dom';
import { PageSkeleton } from './Skeleton';
import { homeRouteForRole, useAuth, type UserRole } from '../contexts/AuthContext';
import type { ReactNode } from 'react';

type ProtectedRouteProps = {
  /** Roles allowed to open this route. A signed-in user with any other role is
   *  bounced back to their own dashboard. */
  allow: UserRole[];
  children: ReactNode;
};

const ProtectedRoute = ({ allow, children }: ProtectedRouteProps) => {
  const { role, session, loading } = useAuth();

  if (loading) {
    return <PageSkeleton />;
  }

  // Not signed in at all, or signed in but without a profile row yet.
  if (!role || (role !== 'Admin' && !session)) {
    return <Navigate to="/login" replace />;
  }

  if (!allow.includes(role)) {
    return <Navigate to={homeRouteForRole(role)} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
