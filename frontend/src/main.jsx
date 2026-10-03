import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/Toasts.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import { AuthProvider } from './lib/auth.jsx';
import './styles.css';

function NotFound() {
  return (
    <div className="center-screen">
      <div className="card prompt-card">
        <h2>Page not found</h2>
        <Link className="btn btn-primary btn-block" to="/">
          Go home
        </Link>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomId" element={<Room />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
