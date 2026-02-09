/**
 * 应用主组件
 *
 * 配置路由和全局布局
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PairingPage } from './pages/PairingPage';
import { DashboardPage } from './pages/DashboardPage';
import { useConnectionStore } from './stores/connectionStore';

/**
 * 根路由重定向组件
 *
 * 根据连接状态自动重定向到配对页面或仪表盘
 */
function RootRedirect() {
  const { state } = useConnectionStore();

  // 如果已配对，跳转到仪表盘
  if (state === 'paired') {
    return <Navigate to="/dashboard" replace />;
  }

  // 否则跳转到配对页面
  return <Navigate to="/pair" replace />;
}

/**
 * 应用主组件
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 根路由重定向 */}
        <Route path="/" element={<RootRedirect />} />

        {/* 配对页面 */}
        <Route path="/pair" element={<PairingPage />} />

        {/* 仪表盘页面 */}
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* 404 重定向 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
