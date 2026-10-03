import Icon from './Icons.jsx';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const TOAST_ICON = { success: 'check', warning: 'alert', error: 'alert', info: 'info' };

const ToastContext = createContext({ notify: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (message, kind = 'info', duration = 3800) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-3), { id, message, kind }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            <Icon name={TOAST_ICON[t.kind] ?? 'info'} size={16} className="toast-icon" />
            <span>{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
