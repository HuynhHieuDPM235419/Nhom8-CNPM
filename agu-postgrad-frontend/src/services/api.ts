const BASE_URL = 'http://localhost:5000/api';

// Helper gửi request kèm Token tự động
async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('agu_token');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Không đặt Content-Type nếu body là FormData (để browser tự generate boundary)
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Lỗi khi gọi API!');
  }
  return data;
}

export const api = {
  // 1. Phân hệ Xác thực & Hệ thống
  auth: {
    login: (body: { username: string; password: string }) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
    getProfile: () => request('/auth/profile'),
    changePassword: (body: { oldPassword: string; newPassword: string }) =>
      request('/auth/change-password', { method: 'PUT', body: JSON.stringify(body) }),
    getNotifications: () => request('/auth/notifications'),
    markNotificationRead: (id: number | string) =>
      request(`/auth/notifications/${id}/read`, { method: 'PUT' })
  },

  // 2. Phân hệ Tuyển sinh Thạc sĩ
  admission: {
    getCampaigns: () => request('/admission/campaigns'),
    register: (formData: FormData) =>
      request('/admission/register', { method: 'POST', body: formData }),
    lookup: (key: string) => request(`/admission/lookup?key=${encodeURIComponent(key)}`),
    getAllProfiles: (params?: { status?: string; admissionStatus?: string; campaignId?: number }) => {
      const q = new URLSearchParams(params as any).toString();
      return request(`/admission/profiles?${q}`);
    },
    reviewProfile: (id: number | string, status: string) =>
      request(`/admission/profiles/${id}/review`, { method: 'PUT', body: JSON.stringify({ status }) }),
    admitCandidate: (id: number | string, curriculumId = 1) =>
      request(`/admission/profiles/${id}/admit`, { method: 'POST', body: JSON.stringify({ curriculumId }) })
  },

  // 3. Phân hệ Chương trình đào tạo & Giảng viên
  academic: {
    getMajors: () => request('/academic/majors'),
    getCurriculums: (majorId?: number) =>
      request(`/academic/curriculums${majorId ? `?majorId=${majorId}` : ''}`),
    getCurriculumCourses: (curriculumId: number | string) =>
      request(`/academic/curriculums/${curriculumId}/courses`),
    getLecturers: () => request('/academic/lecturers'),
    getSemesters: () => request('/academic/semesters'),
    getClasses: (semesterId?: number) =>
      request(`/academic/classes${semesterId ? `?semesterId=${semesterId}` : ''}`)
  },

  // 4. Phân hệ Học viên & Điểm số
  student: {
    getMyInfo: () => request('/students/me'),
    getTuition: (studentId?: number | string) =>
      request(`/students/tuition${studentId ? `?studentId=${studentId}` : ''}`),
    payTuition: (tuitionId: number | string, amount: number) =>
      request('/students/tuition/pay', { method: 'POST', body: JSON.stringify({ tuitionId, amount }) }),
    registerCourse: (classId: number) =>
      request('/students/register-course', { method: 'POST', body: JSON.stringify({ classId }) }),
    getSchedule: () => request('/students/schedule'),
    getGrades: (studentId?: number | string) =>
      request(`/students/grades${studentId ? `?studentId=${studentId}` : ''}`),
    enterGrades: (body: { gradeId: number | string; processGrade?: number; examGrade?: number }) =>
      request('/students/enter-grades', { method: 'PUT', body: JSON.stringify(body) })
  },

  // 5. Phân hệ Luận văn, GVHD & Tiến độ 5 mốc
  thesis: {
    registerAdvisor: (body: { lecturerId: number; role?: string }) =>
      request('/thesis/register-advisor', { method: 'POST', body: JSON.stringify(body) }),
    getFacultyAdvisingRequests: (lecturerId?: number) =>
      request(`/thesis/faculty/advising-requests${lecturerId ? `?lecturerId=${lecturerId}` : ''}`),
    respondAdvisingRequest: (id: number | string, action: 'accept' | 'reject') =>
      request(`/thesis/faculty/advising-requests/${id}`, { method: 'PUT', body: JSON.stringify({ action }) }),
    registerTopic: (thesisTitle: string) =>
      request('/thesis/register-topic', { method: 'POST', body: JSON.stringify({ thesisTitle }) }),
    getMyProgress: (studentId?: number | string) =>
      request(`/thesis/my-progress${studentId ? `?studentId=${studentId}` : ''}`),
    submitReport: (formData: FormData) =>
      request('/thesis/submit-report', { method: 'POST', body: formData }),
    submitTurnitin: (formData: FormData) =>
      request('/thesis/submit-turnitin', { method: 'POST', body: formData }),
    submitPublication: (formData: FormData) =>
      request('/thesis/submit-publication', { method: 'POST', body: formData }),
    submitCertificate: (formData: FormData) =>
      request('/thesis/submit-certificate', { method: 'POST', body: formData }),
    evaluateSubmission: (id: number | string, body: { feedback?: string; status: 'Đạt' | 'Cần sửa đổi' }) =>
      request(`/thesis/evaluate-submission/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  },

  // 6. Phân hệ Hội đồng & Gatekeeper
  committee: {
    checkGatekeeper: (studentId?: number | string) =>
      request(`/committee/gatekeeper-check${studentId ? `/${studentId}` : ''}`),
    createCommittee: (body: any) =>
      request('/committee/create', { method: 'POST', body: JSON.stringify(body) }),
    scheduleDefense: (body: { thesisId: number; committeeId: number; defenseOrder?: number; startTime?: string }) =>
      request('/committee/schedule', { method: 'POST', body: JSON.stringify(body) }),
    getSchedules: () => request('/committee/schedules'),
    evaluateDefense: (body: {
      defenseScheduleId: number;
      lecturerId?: number;
      roleInCommittee: string;
      contentScore: number;
      presentationScore: number;
      qaScore: number;
      feedback?: string;
    }) => request('/committee/evaluate', { method: 'POST', body: JSON.stringify(body) }),
    calculateGrade: (scheduleId: number | string) =>
      request(`/committee/calculate-grade/${scheduleId}`, { method: 'POST' })
  },

  // 7. Phân hệ Khảo sát chất lượng (QA)
  survey: {
    getActiveSurveys: () => request('/surveys/active'),
    getQuestions: (campaignId: number | string) => request(`/surveys/${campaignId}/questions`),
    submitResponse: (body: { campaignId: number; answers: { questionId: number; ratingScore: number }[] }) =>
      request('/surveys/submit', { method: 'POST', body: JSON.stringify(body) }),
    getStatistics: (campaignId: number | string) => request(`/surveys/statistics/${campaignId}`)
  }
};

