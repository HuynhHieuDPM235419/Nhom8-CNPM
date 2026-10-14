const { sql, poolPromise, writeAuditLog } = require('../config/db');

// Helper lấy student_id từ user_id nếu token chưa có
async function resolveStudentId(pool, user) {
    if (user.student_id) return user.student_id;
    const res = await pool.request()
        .input('userId', sql.BigInt, user.user_id)
        .query(`SELECT student_id FROM students WHERE user_id = @userId`);
    return res.recordset.length > 0 ? res.recordset[0].student_id : null;
}

// 1. Lấy thông tin cá nhân học viên cao học (GET /api/students/me)
exports.getMyInfo = async (req, res) => {
    try {
        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        if (!studentId) {
            return res.status(404).json({ success: false, message: 'Tài khoản chưa được liên kết với hồ sơ học viên!' });
        }

        const result = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`
                SELECT 
                    s.student_id,
                    s.student_code,
                    s.academic_status,
                    s.enrollment_date,
                    p.full_name,
                    p.dob,
                    p.id_card_number,
                    p.phone,
                    p.email,
                    c.cohort,
                    c.orientation,
                    c.total_credits,
                    m.major_code,
                    m.major_name
                FROM students s
                JOIN admission_profiles p ON s.profile_id = p.profile_id
                JOIN curriculums c ON s.curriculum_id = c.curriculum_id
                JOIN majors m ON c.major_id = m.major_id
                WHERE s.student_id = @studentId
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ học viên!' });
        }

        res.json({ success: true, student: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Tra cứu học phí chi tiết từng học kỳ (GET /api/students/tuition)
exports.getTuition = async (req, res) => {
    try {
        const pool = await poolPromise;
        const studentId = req.user.role_code === 'ADMIN' && req.query.studentId 
            ? req.query.studentId 
            : await resolveStudentId(pool, req.user);

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Thiếu mã học viên!' });
        }

        const result = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`
                SELECT 
                    t.tuition_id,
                    t.base_amount,
                    t.due_date,
                    t.paid_amount,
                    t.late_penalty_fee,
                    t.outstanding_balance,
                    t.status,
                    sem.semester_name,
                    sem.start_date,
                    sem.end_date
                FROM tuition_fees t
                JOIN semesters sem ON t.semester_id = sem.semester_id
                WHERE t.student_id = @studentId
                ORDER BY sem.semester_id DESC
            `);

        const totalDebt = result.recordset.reduce((sum, item) => sum + Number(item.outstanding_balance || 0), 0);

        res.json({
            success: true,
            totalDebt,
            tuitionList: result.recordset
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Đóng học phí / Cập nhật thanh toán (POST /api/students/tuition/pay)
exports.payTuition = async (req, res) => {
    try {
        const { tuitionId, amount } = req.body;
        if (!tuitionId || !amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Số tiền nộp không hợp lệ!' });
        }

        const pool = await poolPromise;
        const tuitionRes = await pool.request()
            .input('tuitionId', sql.BigInt, tuitionId)
            .query(`SELECT base_amount, paid_amount, late_penalty_fee FROM tuition_fees WHERE tuition_id = @tuitionId`);

        if (tuitionRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn học phí!' });
        }

        const record = tuitionRes.recordset[0];
        const newPaid = Number(record.paid_amount) + Number(amount);
        const totalDue = Number(record.base_amount) + Number(record.late_penalty_fee);
        const newStatus = newPaid >= totalDue ? 'Hoàn thành' : 'Đã thanh toán một phần';

        await pool.request()
            .input('tuitionId', sql.BigInt, tuitionId)
            .input('paidAmount', sql.Decimal(12, 2), newPaid)
            .input('status', sql.NVarChar, newStatus)
            .query(`UPDATE tuition_fees SET paid_amount = @paidAmount, status = @status WHERE tuition_id = @tuitionId`);

        await writeAuditLog(req.user?.user_id, 'PAY_TUITION', 'tuition_fees', tuitionId, { oldPaid: record.paid_amount }, { newPaid, amount }, req.ip);

        res.json({
            success: true,
            message: `Ghi nhận thanh toán thành công: ${amount.toLocaleString('vi-VN')} VNĐ!`,
            newStatus,
            newPaid
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Đăng ký học phần (POST /api/students/register-course)
exports.registerCourse = async (req, res) => {
    try {
        const { classId } = req.body;
        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        if (!studentId || !classId) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin lớp học phần!' });
        }

        // Kiểm tra lớp có mở không và sĩ số
        const classCheck = await pool.request()
            .input('classId', sql.Int, classId)
            .query(`
                SELECT max_students, status,
                       (SELECT COUNT(*) FROM course_registrations WHERE class_id = @classId) AS current_count
                FROM course_classes WHERE class_id = @classId
            `);

        if (classCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Lớp học phần không tồn tại!' });
        }

        const cInfo = classCheck.recordset[0];
        if (cInfo.status !== 'Mở đăng ký') {
            return res.status(400).json({ success: false, message: `Lớp học phần hiện đang ở trạng thái: ${cInfo.status}` });
        }

        if (cInfo.current_count >= cInfo.max_students) {
            return res.status(400).json({ success: false, message: 'Lớp học phần đã đầy sĩ số tối đa!' });
        }

        // Đăng ký và sinh bản ghi điểm rỗng
        const regInsert = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .input('classId', sql.Int, classId)
            .query(`
                INSERT INTO course_registrations (student_id, class_id)
                OUTPUT INSERTED.registration_id
                VALUES (@studentId, @classId)
            `);

        const regId = regInsert.recordset[0].registration_id;

        await pool.request()
            .input('regId', sql.BigInt, regId)
            .query(`INSERT INTO student_grades (registration_id, process_grade, exam_grade, final_grade, is_locked)
                    VALUES (@regId, NULL, NULL, NULL, 0)`);

        res.status(201).json({ success: true, message: 'Đăng ký học phần thành công!' });
    } catch (err) {
        if (err.message && err.message.includes('UQ_student_class')) {
            return res.status(400).json({ success: false, message: 'Bạn đã đăng ký học phần này rồi!' });
        }
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Xem danh sách lớp học phần đã đăng ký & Thời khóa biểu (GET /api/students/schedule)
exports.getMyCourses = async (req, res) => {
    try {
        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        const result = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`
                SELECT 
                    cr.registration_id,
                    cr.registered_at,
                    cc.class_name,
                    c.course_code,
                    c.course_name,
                    c.credits,
                    sem.semester_name,
                    sch.room_name,
                    sch.day_of_week,
                    sch.start_shift,
                    sch.end_shift,
                    l.full_name AS lecturer_name
                FROM course_registrations cr
                JOIN course_classes cc ON cr.class_id = cc.class_id
                JOIN courses c ON cc.course_id = c.course_id
                JOIN semesters sem ON cc.semester_id = sem.semester_id
                LEFT JOIN schedules sch ON cc.class_id = sch.class_id
                LEFT JOIN lecturers l ON sch.lecturer_id = l.lecturer_id
                WHERE cr.student_id = @studentId
                ORDER BY sem.semester_id DESC, sch.day_of_week ASC
            `);

        res.json({ success: true, courses: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 6. Xem bảng điểm học viên (GET /api/students/grades)
exports.getMyGrades = async (req, res) => {
    try {
        const pool = await poolPromise;
        const studentId = req.user.role_code === 'ADMIN' && req.query.studentId
            ? req.query.studentId
            : await resolveStudentId(pool, req.user);

        const result = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`
                SELECT 
                    g.grade_id,
                    g.process_grade,
                    g.exam_grade,
                    g.final_grade,
                    g.is_locked,
                    c.course_code,
                    c.course_name,
                    c.credits,
                    sem.semester_name
                FROM student_grades g
                JOIN course_registrations cr ON g.registration_id = cr.registration_id
                JOIN course_classes cc ON cr.class_id = cc.class_id
                JOIN courses c ON cc.course_id = c.course_id
                JOIN semesters sem ON cc.semester_id = sem.semester_id
                WHERE cr.student_id = @studentId
            `);

        res.json({ success: true, grades: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 7. Nhập điểm học phần - Giảng viên / Admin (PUT /api/students/enter-grades)
exports.enterGrades = async (req, res) => {
    try {
        const { gradeId, processGrade, examGrade } = req.body;
        if (!gradeId) {
            return res.status(400).json({ success: false, message: 'Thiếu mã bản ghi điểm!' });
        }

        const pool = await poolPromise;
        const gradeCheck = await pool.request()
            .input('gradeId', sql.BigInt, gradeId)
            .query(`SELECT is_locked FROM student_grades WHERE grade_id = @gradeId`);

        if (gradeCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi điểm!' });
        }

        if (gradeCheck.recordset[0].is_locked) {
            return res.status(400).json({ success: false, message: 'Điểm của học phần này đã bị khóa, không thể chỉnh sửa!' });
        }

        const pGrade = processGrade !== undefined ? parseFloat(processGrade) : null;
        const eGrade = examGrade !== undefined ? parseFloat(examGrade) : null;
        let finalGrade = null;
        if (pGrade !== null && eGrade !== null) {
            finalGrade = Math.round((pGrade * 0.4 + eGrade * 0.6) * 100) / 100;
        }

        await pool.request()
            .input('gradeId', sql.BigInt, gradeId)
            .input('pGrade', sql.Decimal(4, 2), pGrade)
            .input('eGrade', sql.Decimal(4, 2), eGrade)
            .input('fGrade', sql.Decimal(4, 2), finalGrade)
            .query(`
                UPDATE student_grades
                SET process_grade = @pGrade, exam_grade = @eGrade, final_grade = @fGrade
                WHERE grade_id = @gradeId
            `);

        await writeAuditLog(req.user?.user_id, 'ENTER_GRADES', 'student_grades', gradeId, null, { pGrade, eGrade, finalGrade }, req.ip);

        res.json({
            success: true,
            message: 'Cập nhật điểm thành công!',
            data: { gradeId, processGrade: pGrade, examGrade: eGrade, finalGrade }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
