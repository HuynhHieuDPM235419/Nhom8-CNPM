const { sql, poolPromise, writeAuditLog } = require('../config/db');

// Helper lấy student_id
async function resolveStudentId(pool, user) {
    if (user.student_id) return user.student_id;
    const res = await pool.request()
        .input('userId', sql.BigInt, user.user_id)
        .query(`SELECT student_id FROM students WHERE user_id = @userId`);
    return res.recordset.length > 0 ? res.recordset[0].student_id : null;
}

// Helper lấy lecturer_id
async function resolveLecturerId(pool, user) {
    if (user.lecturer_id) return user.lecturer_id;
    const res = await pool.request()
        .input('userId', sql.BigInt, user.user_id)
        .query(`SELECT lecturer_id FROM lecturers WHERE user_id = @userId`);
    return res.recordset.length > 0 ? res.recordset[0].lecturer_id : null;
}

// 1. Học viên đăng ký Giảng viên Hướng dẫn (POST /api/thesis/register-advisor)
exports.registerAdvisor = async (req, res) => {
    try {
        const { lecturerId, role = 'Hướng dẫn chính' } = req.body;
        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        if (!studentId || !lecturerId) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin học viên hoặc giảng viên!' });
        }

        // Kiểm tra giảng viên và số slot còn lại
        const lecCheck = await pool.request()
            .input('lecId', sql.Int, lecturerId)
            .query(`
                SELECT max_slots, degree,
                    (SELECT COUNT(*) FROM advisor_assignments WHERE lecturer_id = @lecId AND status = N'Đang hướng dẫn') AS assigned_count
                FROM lecturers WHERE lecturer_id = @lecId
            `);

        if (lecCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Giảng viên không tồn tại!' });
        }

        const { max_slots, assigned_count } = lecCheck.recordset[0];
        if (assigned_count >= max_slots) {
            return res.status(400).json({ success: false, message: 'Giảng viên này đã đạt định mức tối đa học viên hướng dẫn trong đợt này!' });
        }

        // Kiểm tra xem học viên đã gửi yêu cầu cho GV này chưa
        const existReq = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .input('lecId', sql.Int, lecturerId)
            .query(`SELECT advisor_assignment_id, status FROM advisor_assignments WHERE student_id = @studentId AND lecturer_id = @lecId`);

        if (existReq.recordset.length > 0) {
            return res.status(400).json({ success: false, message: `Bạn đã có yêu cầu với giảng viên này (Trạng thái: ${existReq.recordset[0].status})!` });
        }

        await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .input('lecId', sql.Int, lecturerId)
            .input('role', sql.NVarChar, role)
            .query(`
                INSERT INTO advisor_assignments (student_id, lecturer_id, role, status)
                VALUES (@studentId, @lecId, @role, N'Chờ GVHD duyệt')
            `);

        await writeAuditLog(req.user?.user_id, 'REGISTER_ADVISOR', 'advisor_assignments', null, null, { lecturerId, studentId }, req.ip);

        // Bắn Socket thông báo nếu có io gắn vào app
        const io = req.app.get('io');
        if (io) {
            io.emit('advisor_request_received', { lecturerId, studentId });
        }

        res.status(201).json({ success: true, message: 'Gửi yêu cầu đăng ký hướng dẫn thành công! Đang chờ Thầy/Cô xét duyệt.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Giảng viên xem danh sách yêu cầu đăng ký hướng dẫn chờ duyệt (GET /api/faculty/advising-requests)
// Phục vụ màn hình FacultyDashboard.tsx
exports.getFacultyAdvisingRequests = async (req, res) => {
    try {
        const pool = await poolPromise;
        const lecturerId = req.user.role_code === 'ADMIN' && req.query.lecturerId
            ? req.query.lecturerId
            : await resolveLecturerId(pool, req.user);

        if (!lecturerId) {
            return res.status(400).json({ success: false, message: 'Thiếu mã giảng viên!' });
        }

        // Lấy thông tin Quota của Giảng viên
        const quotaRes = await pool.request()
            .input('lecId', sql.Int, lecturerId)
            .query(`
                SELECT l.lecturer_id, l.full_name, l.degree, l.max_slots,
                    (SELECT COUNT(*) FROM advisor_assignments WHERE lecturer_id = l.lecturer_id AND status = N'Đang hướng dẫn') AS assigned_count
                FROM lecturers l WHERE l.lecturer_id = @lecId
            `);

        const lecturerInfo = quotaRes.recordset[0];

        // Lấy danh sách yêu cầu chờ duyệt & đang hướng dẫn
        const requestsRes = await pool.request()
            .input('lecId', sql.Int, lecturerId)
            .query(`
                SELECT 
                    aa.advisor_assignment_id,
                    aa.role,
                    aa.assigned_date,
                    aa.status,
                    s.student_id,
                    s.student_code,
                    p.full_name AS student_name,
                    p.email,
                    p.phone,
                    tp.thesis_title,
                    tp.current_stage,
                    tp.progress_percent
                FROM advisor_assignments aa
                JOIN students s ON aa.student_id = s.student_id
                JOIN admission_profiles p ON s.profile_id = p.profile_id
                LEFT JOIN thesis_progress tp ON s.student_id = tp.student_id
                WHERE aa.lecturer_id = @lecId
                ORDER BY aa.assigned_date DESC
            `);

        res.json({
            success: true,
            quota: {
                maxSlots: lecturerInfo.max_slots,
                assignedCount: lecturerInfo.assigned_count,
                slotsLeft: lecturerInfo.max_slots - lecturerInfo.assigned_count
            },
            requests: requestsRes.recordset
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Giảng viên phê duyệt hoặc từ chối nhận hướng dẫn (PUT /api/faculty/advising-requests/:id)
exports.respondAdvisingRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'accept' hoặc 'reject'
        const pool = await poolPromise;

        const assignRes = await pool.request()
            .input('id', sql.BigInt, id)
            .query(`SELECT lecturer_id, student_id, status FROM advisor_assignments WHERE advisor_assignment_id = @id`);

        if (assignRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu hướng dẫn!' });
        }

        const assignRecord = assignRes.recordset[0];
        const newStatus = action === 'accept' ? 'Đang hướng dẫn' : 'Từ chối';

        if (action === 'accept') {
            // Kiểm tra lại slot trước khi chốt nhận
            const slotCheck = await pool.request()
                .input('lecId', sql.Int, assignRecord.lecturer_id)
                .query(`
                    SELECT max_slots, 
                           (SELECT COUNT(*) FROM advisor_assignments WHERE lecturer_id = @lecId AND status = N'Đang hướng dẫn') AS current_assigned
                    FROM lecturers WHERE lecturer_id = @lecId
                `);
            const { max_slots, current_assigned } = slotCheck.recordset[0];
            if (current_assigned >= max_slots) {
                return res.status(400).json({ success: false, message: 'Giảng viên đã hết slot hướng dẫn, không thể nhận thêm!' });
            }
        }

        await pool.request()
            .input('id', sql.BigInt, id)
            .input('status', sql.NVarChar, newStatus)
            .query(`UPDATE advisor_assignments SET status = @status WHERE advisor_assignment_id = @id`);

        // Bắn Socket realtime cập nhật slot
        const io = req.app.get('io');
        if (io) {
            const countRes = await pool.request()
                .input('lecId', sql.Int, assignRecord.lecturer_id)
                .query(`SELECT COUNT(*) AS c FROM advisor_assignments WHERE lecturer_id = @lecId AND status = N'Đang hướng dẫn'`);
            io.emit('slot_updated', { lecturerId: assignRecord.lecturer_id, currentSlots: countRes.recordset[0].c });
        }

        await writeAuditLog(req.user?.user_id, 'RESPOND_ADVISOR_REQUEST', 'advisor_assignments', id, { oldStatus: assignRecord.status }, { newStatus }, req.ip);

        res.json({ success: true, message: `Đã ${action === 'accept' ? 'đồng ý nhận' : 'từ chối'} hướng dẫn học viên!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Đăng ký / Cập nhật đề tài Luận văn Thạc sĩ (POST /api/thesis/register-topic)
exports.registerThesisTopic = async (req, res) => {
    try {
        const { thesisTitle } = req.body;
        if (!thesisTitle || thesisTitle.trim().length < 10) {
            return res.status(400).json({ success: false, message: 'Tên đề tài phải có ít nhất 10 ký tự!' });
        }

        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Thiếu mã học viên!' });
        }

        const checkThesis = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`SELECT thesis_id FROM thesis_progress WHERE student_id = @studentId`);

        if (checkThesis.recordset.length > 0) {
            await pool.request()
                .input('studentId', sql.BigInt, studentId)
                .input('title', sql.NVarChar, thesisTitle.trim())
                .query(`UPDATE thesis_progress SET thesis_title = @title, status = N'Chờ GVHD duyệt' WHERE student_id = @studentId`);
        } else {
            await pool.request()
                .input('studentId', sql.BigInt, studentId)
                .input('title', sql.NVarChar, thesisTitle.trim())
                .query(`
                    INSERT INTO thesis_progress (student_id, thesis_title, current_stage, progress_percent, status)
                    VALUES (@studentId, @title, N'Đăng ký đề tài', 10, N'Chờ GVHD duyệt')
                `);
        }

        res.json({ success: true, message: 'Đăng ký đề tài luận văn thành công! Đang chờ Giảng viên hướng dẫn thông qua.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Lấy toàn bộ tiến trình luận văn 5 mốc & Cảnh báo màu (GET /api/thesis/my-progress)
// Phục vụ trực tiếp cho màn hình StudentDashboard.tsx
exports.getMyThesisProgress = async (req, res) => {
    try {
        const pool = await poolPromise;
        const studentId = req.user.role_code === 'ADMIN' && req.query.studentId
            ? req.query.studentId
            : await resolveStudentId(pool, req.user);

        if (!studentId) {
            return res.status(400).json({ success: false, message: 'Không tìm thấy hồ sơ học viên!' });
        }

        // 1. Thông tin Đề tài
        const thesisRes = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`SELECT * FROM thesis_progress WHERE student_id = @studentId`);

        const thesis = thesisRes.recordset[0] || null;

        // 2. Thông tin Giảng viên hướng dẫn
        const advisorRes = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`
                SELECT aa.role, aa.status, l.full_name AS lecturer_name, l.degree, l.email, l.phone
                FROM advisor_assignments aa
                JOIN lecturers l ON aa.lecturer_id = l.lecturer_id
                WHERE aa.student_id = @studentId
            `);

        // 3. Danh sách các bài nộp theo từng mốc (kèm màu cảnh báo Xanh/Vàng/Đỏ)
        let submissions = [];
        if (thesis) {
            const subRes = await pool.request()
                .input('thesisId', sql.BigInt, thesis.thesis_id)
                .query(`
                    SELECT submission_id, stage_name, report_file_url, deadline, submitted_at,
                           lecturer_feedback, color_warning, status
                    FROM thesis_submissions
                    WHERE thesis_id = @thesisId
                    ORDER BY deadline ASC
                `);
            submissions = subRes.recordset;
        }

        // 4. Kết quả Turnitin gần nhất
        let turnitin = null;
        if (thesis) {
            const turRes = await pool.request()
                .input('thesisId', sql.BigInt, thesis.thesis_id)
                .query(`SELECT TOP 1 * FROM turnitin_checks WHERE thesis_id = @thesisId ORDER BY checked_at DESC`);
            turnitin = turRes.recordset[0] || null;
        }

        // 5. Bài báo khoa học & Chứng chỉ ngoại ngữ
        const pubRes = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`SELECT * FROM scientific_publications WHERE student_id = @studentId`);

        const langRes = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`SELECT * FROM language_certificates WHERE student_id = @studentId`);

        res.json({
            success: true,
            thesis,
            advisor: advisorRes.recordset[0] || null,
            milestones: submissions,
            turnitin,
            publications: pubRes.recordset,
            languageCerts: langRes.recordset
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 6. Nộp báo cáo tiến độ / Bản thảo luận văn (POST /api/thesis/submit-report)
// Hỗ trợ upload file <= 25MB
exports.submitThesisReport = async (req, res) => {
    try {
        const { stageName, deadline } = req.body;
        const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng đính kèm file báo cáo (≤ 25MB, định dạng PDF/DOC/DOCX)!' });
        }

        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        const thesisRes = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`SELECT thesis_id FROM thesis_progress WHERE student_id = @studentId`);

        if (thesisRes.recordset.length === 0) {
            return res.status(400).json({ success: false, message: 'Bạn chưa đăng ký đề tài luận văn!' });
        }

        const thesisId = thesisRes.recordset[0].thesis_id;

        await pool.request()
            .input('thesisId', sql.BigInt, thesisId)
            .input('stageName', sql.NVarChar, stageName || 'Báo cáo tiến độ')
            .input('fileUrl', sql.NVarChar, fileUrl)
            .input('deadline', sql.Date, deadline || '2026-12-31')
            .query(`
                INSERT INTO thesis_submissions (thesis_id, stage_name, report_file_url, deadline, submitted_at, color_warning, status)
                VALUES (@thesisId, @stageName, @fileUrl, @deadline, GETDATE(), 'green', N'Chờ đánh giá')
            `);

        // Cập nhật trạng thái tổng quan
        await pool.request()
            .input('thesisId', sql.BigInt, thesisId)
            .input('stageName', sql.NVarChar, stageName)
            .query(`UPDATE thesis_progress SET current_stage = @stageName WHERE thesis_id = @thesisId`);

        res.status(201).json({
            success: true,
            message: 'Nộp báo cáo thành công! File đã được lưu an toàn.',
            fileUrl
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 7. Nộp kết quả kiểm tra Turnitin (POST /api/thesis/submit-turnitin)
exports.submitTurnitin = async (req, res) => {
    try {
        const { similarityScore } = req.body;
        const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        if (similarityScore === undefined || !fileUrl) {
            return res.status(400).json({ success: false, message: 'Vui lòng cung cấp tỷ lệ trùng lặp (%) và file kết quả Turnitin!' });
        }

        const score = parseFloat(similarityScore);
        const status = score <= 20.0 ? 'Đạt' : (score <= 25.0 ? 'Cảnh báo' : 'Không đạt');

        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);
        const thesisRes = await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .query(`SELECT thesis_id FROM thesis_progress WHERE student_id = @studentId`);

        if (thesisRes.recordset.length === 0) {
            return res.status(400).json({ success: false, message: 'Chưa có thông tin đề tài!' });
        }

        await pool.request()
            .input('thesisId', sql.BigInt, thesisRes.recordset[0].thesis_id)
            .input('fileUrl', sql.NVarChar, fileUrl)
            .input('score', sql.Decimal(5, 2), score)
            .input('status', sql.NVarChar, status)
            .query(`
                INSERT INTO turnitin_checks (thesis_id, file_url, similarity_score, status)
                VALUES (@thesisId, @fileUrl, @score, @status)
            `);

        res.status(201).json({
            success: true,
            message: `Ghi nhận kết quả Turnitin: ${score}% (${status})!`,
            data: { score, status, fileUrl }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 8. Nộp minh chứng Bài báo khoa học (POST /api/thesis/submit-publication)
exports.submitPublication = async (req, res) => {
    try {
        const { paperTitle, journalName, issnIsbn, paperUrl, ranking = 'Tạp chí KH ĐH An Giang' } = req.body;
        const evidenceFile = req.file ? `/uploads/${req.file.filename}` : null;

        if (!paperTitle || !journalName || !evidenceFile) {
            return res.status(400).json({ success: false, message: 'Vui lòng điền tên bài báo, tên tạp chí và upload file minh chứng bài báo!' });
        }

        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .input('paperTitle', sql.NVarChar, paperTitle)
            .input('journalName', sql.NVarChar, journalName)
            .input('issn', sql.VarChar, issnIsbn || null)
            .input('paperUrl', sql.NVarChar, paperUrl || null)
            .input('ranking', sql.NVarChar, ranking)
            .input('evidenceFile', sql.NVarChar, evidenceFile)
            .query(`
                INSERT INTO scientific_publications (student_id, paper_title, journal_name, issn_isbn, paper_url, ranking, points, evidence_file, status)
                VALUES (@studentId, @paperTitle, @journalName, @issn, @paperUrl, @ranking, 0.5, @evidenceFile, N'Chờ thẩm định')
            `);

        res.status(201).json({ success: true, message: 'Nộp minh chứng bài báo khoa học thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 9. Nộp chứng chỉ Tiếng Anh chuẩn đầu ra (POST /api/thesis/submit-certificate)
exports.submitLanguageCertificate = async (req, res) => {
    try {
        const { certType = 'VSTEP Bậc 4 (B2 ĐHQG-HCM)', scoreAchieved, issueDate, expiryDate } = req.body;
        const certFileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        if (!scoreAchieved || !issueDate || !certFileUrl) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập điểm/bậc đạt được, ngày cấp và upload bản scan chứng chỉ!' });
        }

        const pool = await poolPromise;
        const studentId = await resolveStudentId(pool, req.user);

        await pool.request()
            .input('studentId', sql.BigInt, studentId)
            .input('certType', sql.NVarChar, certType)
            .input('score', sql.NVarChar, scoreAchieved)
            .input('issueDate', sql.Date, issueDate)
            .input('expiryDate', sql.Date, expiryDate || null)
            .input('fileUrl', sql.NVarChar, certFileUrl)
            .query(`
                INSERT INTO language_certificates (student_id, cert_type, score_achieved, issue_date, expiry_date, certificate_file_url, status)
                VALUES (@studentId, @certType, @score, @issueDate, @expiryDate, @fileUrl, N'Chờ xét duyệt')
            `);

        res.status(201).json({ success: true, message: 'Nộp chứng chỉ ngoại ngữ chuẩn đầu ra thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 10. Giảng viên đánh giá mốc tiến độ (PUT /api/thesis/evaluate-submission/:id)
exports.evaluateSubmission = async (req, res) => {
    try {
        const { id } = req.params;
        const { feedback, status } = req.body; // status: 'Đạt' hoặc 'Cần sửa đổi'
        const pool = await poolPromise;

        await pool.request()
            .input('subId', sql.BigInt, id)
            .input('feedback', sql.NVarChar, feedback || null)
            .input('status', sql.NVarChar, status || 'Đạt')
            .query(`
                UPDATE thesis_submissions
                SET lecturer_feedback = @feedback, status = @status
                WHERE submission_id = @subId
            `);

        res.json({ success: true, message: 'Đã lưu nhận xét và đánh giá của Giảng viên!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
