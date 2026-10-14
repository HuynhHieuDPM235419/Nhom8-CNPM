const { sql, poolPromise } = require('../config/db');

// 1. Lấy danh sách ngành đào tạo Thạc sĩ (GET /api/academic/majors)
exports.getMajors = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT major_id, major_code, major_name
            FROM majors
            ORDER BY major_id ASC
        `);
        res.json({ success: true, majors: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Lấy khung chương trình đào tạo (GET /api/academic/curriculums)
exports.getCurriculums = async (req, res) => {
    try {
        const { majorId } = req.query;
        const pool = await poolPromise;
        let queryStr = `
            SELECT c.curriculum_id, c.cohort, c.orientation, c.total_credits, c.version,
                   m.major_code, m.major_name
            FROM curriculums c
            JOIN majors m ON c.major_id = m.major_id
            WHERE 1=1
        `;
        const request = pool.request();
        if (majorId) {
            queryStr += ` AND c.major_id = @majorId`;
            request.input('majorId', sql.Int, majorId);
        }

        const result = await request.query(queryStr);
        res.json({ success: true, curriculums: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Lấy danh sách học phần trong một CTĐT (GET /api/academic/curriculums/:id/courses)
exports.getCurriculumCourses = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('curriculumId', sql.Int, id)
            .query(`
                SELECT cc.curriculum_course_id, cc.course_type, cc.recommended_semester,
                       c.course_id, c.course_code, c.course_name, c.credits,
                       prereq.course_code AS prerequisite_code, prereq.course_name AS prerequisite_name
                FROM curriculum_courses cc
                JOIN courses c ON cc.course_id = c.course_id
                LEFT JOIN courses prereq ON c.prerequisite_course_id = prereq.course_id
                WHERE cc.curriculum_id = @curriculumId
                ORDER BY cc.recommended_semester ASC, c.course_code ASC
            `);
        res.json({ success: true, courses: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Lấy danh sách Giảng viên Hướng dẫn & Slot còn trống (GET /api/academic/lecturers)
// Phục vụ màn hình Giảng viên & chọn GVHD
exports.getLecturers = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                l.lecturer_id,
                l.lecturer_code,
                l.full_name,
                l.degree,
                l.max_slots,
                l.email,
                l.phone,
                ISNULL(active_adv.active_count, 0) AS current_assigned,
                (l.max_slots - ISNULL(active_adv.active_count, 0)) AS slots_left
            FROM lecturers l
            LEFT JOIN (
                SELECT lecturer_id, COUNT(*) AS active_count
                FROM advisor_assignments
                WHERE status = N'Đang hướng dẫn'
                GROUP BY lecturer_id
            ) active_adv ON l.lecturer_id = active_adv.lecturer_id
            ORDER BY l.degree DESC, l.full_name ASC
        `);
        res.json({ success: true, lecturers: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Lấy danh sách học kỳ (GET /api/academic/semesters)
exports.getSemesters = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT semester_id, semester_name, start_date, end_date, is_grade_locked
            FROM semesters
            ORDER BY semester_id DESC
        `);
        res.json({ success: true, semesters: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 6. Lấy danh sách lớp học phần mở đăng ký (GET /api/academic/classes)
exports.getClasses = async (req, res) => {
    try {
        const { semesterId } = req.query;
        const pool = await poolPromise;
        let queryStr = `
            SELECT 
                cc.class_id,
                cc.class_name,
                cc.max_students,
                cc.status,
                c.course_id,
                c.course_code,
                c.course_name,
                c.credits,
                sem.semester_name,
                (SELECT COUNT(*) FROM course_registrations cr WHERE cr.class_id = cc.class_id) AS registered_count
            FROM course_classes cc
            JOIN courses c ON cc.course_id = c.course_id
            JOIN semesters sem ON cc.semester_id = sem.semester_id
            WHERE 1=1
        `;

        const request = pool.request();
        if (semesterId) {
            queryStr += ` AND cc.semester_id = @semesterId`;
            request.input('semesterId', sql.Int, semesterId);
        }

        const result = await request.query(queryStr);
        res.json({ success: true, classes: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

