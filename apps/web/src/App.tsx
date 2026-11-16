import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Shell } from './components/Shell';
import { AvatarFormPage } from './pages/AvatarFormPage';
import { AvatarListPage } from './pages/AvatarListPage';
import { ChatPage } from './pages/ChatPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { NotFoundPage } from './pages/NotFoundPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

/** A page that fails to render leaves the top bar in place, and going elsewhere clears the failure. */
function PageBoundary() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.key}>
      <Outlet />
    </ErrorBoundary>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route element={<PageBoundary />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/avatars" element={<AvatarListPage />} />
          <Route path="/avatars/new" element={<AvatarFormPage />} />
          <Route path="/avatars/:avatarId" element={<AvatarFormPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
