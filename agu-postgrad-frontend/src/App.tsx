import { LoginPage } from './features/auth/LoginPage';
import { useState } from 'react';
import type { TabType } from './types';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { HomePage } from './features/home/HomePage';
import { RegisterPage } from './features/admission/RegisterPage';
import { ResultLookupPage } from './features/lookup/ResultLookupPage';
import { StudentDashboard } from './features/student/StudentDashboard';
import { FacultyDashboard } from './features/faculty/FacultyDashboard';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [selectedMajor, setSelectedMajor] = useState<string>('KTPM');

  const handleNavigate = (tab: TabType, majorCode?: string) => {
    if (majorCode) {
      setSelectedMajor(majorCode);
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 pb-16">
        {activeTab === 'home' && <HomePage onNavigate={handleNavigate} />}
        {activeTab === 'register' && <RegisterPage initialMajorCode={selectedMajor} />}
        {activeTab === 'lookup' && <ResultLookupPage />}
        {activeTab === 'student' && <StudentDashboard />}
        {activeTab === 'faculty' && <FacultyDashboard />}
        {activeTab === 'login' && <LoginPage onNavigate={setActiveTab} />}
      </main>

      <Footer />
    </div>
  );
}