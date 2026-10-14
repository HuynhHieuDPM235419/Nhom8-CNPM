import React, { useState } from 'react';
import type { TabType } from '../../types';
import { api } from '../../services/api';

interface LoginPageProps {
  onNavigate?: (tab: TabType) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await api.auth.login({ username: email.trim(), password });
      if (!result.success || !result.token) {
        throw new Error(result.message || 'Đăng nhập không thành công.');
      }

      localStorage.setItem('agu_token', result.token);
      localStorage.setItem('agu_user', JSON.stringify(result.user));

      const destination: TabType = result.user?.roleCode === 'STUDENT'
        ? 'student'
        : result.user?.roleCode === 'LECTURER'
          ? 'faculty'
          : 'home';
      onNavigate?.(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đăng nhập. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-slate-100">
        <h2 className="mb-2 text-center text-2xl font-bold text-slate-800">
          Đăng Nhập
        </h2>
        <p className="mb-6 text-center text-sm text-slate-500">
          Hệ Thống Quản Lý Đào Tạo Sau Đại Học
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-slate-700">
              Tên đăng nhập / Email
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              placeholder="Nhập tên đăng nhập hoặc email"
              required
            />
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-slate-700">
              Mật khẩu
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-700 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>

        {onNavigate && (
          <p className="mt-4 text-center text-xs text-slate-500">
            Chưa có tài khoản?{' '}
            <button
              type="button"
              onClick={() => onNavigate('register')}
              className="font-semibold text-sky-600 hover:underline"
            >
              Đăng ký ngay
            </button>
          </p>
        )}
      </div>
    </div>
  );
};