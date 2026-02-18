import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DaemonHubPage } from './pages/DaemonHubPage';
import { DashboardPage } from './pages/DashboardPage';
import { useWebAuthStore } from './stores/webAuthStore';

function RootRedirect() {
  const { status } = useWebAuthStore();

  if (status === 'checking') {
    return <LoadingScreen />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/daemons" replace />;
  }

  return <Navigate to="/login" replace />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status } = useWebAuthStore();

  if (status === 'checking') {
    return <LoadingScreen />;
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex items-center gap-3 text-gray-300">
        <div className="w-5 h-5 rounded-full border-2 border-gray-600 border-t-emerald-400 animate-spin" />
        <span>正在检查登录状态...</span>
      </div>
    </div>
  );
}

function App() {
  const { initialized, checkSession } = useWebAuthStore();

  useEffect(() => {
    if (!initialized) {
      void checkSession();
    }
  }, [initialized, checkSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/daemons"
          element={(
            <ProtectedRoute>
              <DaemonHubPage />
            </ProtectedRoute>
          )}
        />

        <Route
          path="/sessions"
          element={(
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          )}
        />

        {/* 兼容历史入口 */}
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
