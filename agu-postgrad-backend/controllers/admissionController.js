const { sql, poolPromise, writeAuditLog } = require('../config/db');
const bcrypt = require('bcryptjs');

// 1. Lấy danh sách đợt tuyển sinh đang mở (GET /api/admission/campaigns)
exports.getCampaigns = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT campaign_id, campaign_name, academic_year, start_date, end_date
            FROM admission_campaigns
            ORDER BY academic_year DESC, campaign_id DESC
        `);
        res.json({ success: true, campaigns: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Nộp hồ sơ dự tuyển trực tuyến (POST /api/admission/register)
// Phục vụ màn hình RegisterPage.tsx
exports.registerProfile = async (req, res) => {
    try {
        const { fullName, email, phone, idCardNumber, majorCode, campaignId = 1, dob = '2000-01-01', address } = req.body;
        const degreeFileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        if (!fullName || !email || !phone || !idCardNumber) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ: Họ tên, Email, Số điện thoại và Số CCCD!'
            });
        }

        const pool = await poolPromise;

        // Kiểm tra xem số CCCD đã từng nộp trong đợt này chưa
        const checkExist = await pool.request()
            .input('idCard', sql.VarChar, idCardNumber.trim())
            .query(`SELECT profile_id FROM admission_profiles WHERE id_card_number = @idCard`);

        if (checkExist.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Số CCCD ${idCardNumber} đã tồn tại trong danh sách hồ sơ tuyển sinh!`
            });
        }

        const result = await pool.request()
            .input('campaignId', sql.Int, parseInt(campaignId) || 1)
            .input('fullName', sql.NVarChar, fullName.trim())
            .input('dob', sql.Date, dob)
            .input('idCard', sql.VarChar, idCardNumber.trim())
            .input('phone', sql.VarChar, phone.trim())
            .input('email', sql.VarChar, email.trim().toLowerCase())
            .input('address', sql.NVarChar, address || 'Chưa cập nhật')
            .input('degreeFile', sql.NVarChar, degreeFileUrl)
            .query(`
                INSERT INTO admission_profiles (campaign_id, full_name, dob, id_card_number, phone, email, address, undergrad_degree_file, status, admission_status)
                OUTPUT INSERTED.profile_id
                VALUES (@campaignId, @fullName, @dob, @idCard, @phone, @email, @address, @degreeFile, N'Chờ xét duyệt', N'Chưa trúng tuyển')
            `);

        const profileId = result.recordset[0].profile_id;
        const profileCode = `THS-${new Date().getFullYear()}-${String(profileId).padStart(4, '0')}`;

        res.status(201).json({
            success: true,
            message: 'Nộp hồ sơ dự tuyển Thạc sĩ thành công!',
            data: {
                profileId,
                profileCode,
                fullName,
                idCardNumber,
                degreeFileUrl
            }
        });
    } catch (err) {
        console.error('Lỗi nộp hồ sơ:', err);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + err.message });
    }
};

// 3. Tra cứu kết quả hồ sơ tuyển sinh (GET /api/admission/lookup)
// Phục vụ màn hình ResultLookupPage.tsx
exports.lookupAdmission = async (req, res) => {
    try {
        const { key } = req.query; // Nhận số CCCD hoặc mã hồ sơ (ID)
        if (!key) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập số CCCD hoặc Mã hồ sơ cần tra cứu!' });
        }

        const cleanKey = key.trim().replace(/^THS-\d{4}-/i, ''); // Loại bỏ prefix nếu người dùng nhập THS-2026-0892

        const pool = await poolPromise;
        const result = await pool.request()
            .input('searchKey', sql.VarChar, cleanKey)
            .query(`
                SELECT TOP 1 
                    p.profile_id,
                    p.full_name,
                    p.id_card_number,
                    p.phone,
                    p.email,
                    p.status AS review_status,
                    p.admission_status,
                    p.undergrad_degree_file,
                    p.created_at,
                    c.campaign_name,
                    c.academic_year,
                    s.student_code
                FROM admission_profiles p
                JOIN admission_campaigns c ON p.campaign_id = c.campaign_id
                LEFT JOIN students s ON s.profile_id = p.profile_id
                WHERE p.id_card_number = @searchKey 
                   OR CAST(p.profile_id AS VARCHAR) = @searchKey
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy hồ sơ dự tuyển nào với thông tin đã nhập!'
            });
        }

        const row = result.recordset[0];
        const profileCode = `THS-${row.academic_year || new Date().getFullYear()}-${String(row.profile_id).padStart(4, '0')}`;

        return res.json({
            success: true,
            data: {
                id: profileCode,
                profileId: row.profile_id,
                name: row.full_name,
                idCard: row.id_card_number,
                phone: row.phone,
                email: row.email,
                campaign: row.campaign_name,
                reviewStatus: row.review_status,
                admissionStatus: row.admission_status,
                studentCode: row.student_code || null,
                note: row.admission_status === 'Trúng tuyển' || row.admission_status === 'Đã nhập học'
                    ? 'Chúc mừng! Thí sinh đã trúng tuyển chương trình Sau Đại học tại ĐH An Giang.'
                    : `Hồ sơ hiện đang ở trạng thái: ${row.review_status}. Vui lòng theo dõi email liên tục.`
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Lấy toàn bộ danh sách hồ sơ dự tuyển - Dành cho Ban Tuyển sinh/Admin (GET /api/admission/profiles)
exports.getAllProfiles = async (req, res) => {
    try {
        const { status, admissionStatus, campaignId } = req.query;
        const pool = await poolPromise;

        let queryStr = `
            SELECT p.profile_id, p.full_name, p.dob, p.id_card_number, p.phone, p.email,
                   p.undergrad_degree_file, p.status, p.admission_status, p.created_at,
                   c.campaign_name, s.student_code
            FROM admission_profiles p
            JOIN admission_campaigns c ON p.campaign_id = c.campaign_id
            LEFT JOIN students s ON s.profile_id = p.profile_id
            WHERE 1=1
        `;

        const request = pool.request();
        if (status) {
            queryStr += ` AND p.status = @status`;
            request.input('status', sql.NVarChar, status);
        }
        if (admissionStatus) {
            queryStr += ` AND p.admission_status = @admissionStatus`;
            request.input('admissionStatus', sql.NVarChar, admissionStatus);
        }
        if (campaignId) {
            queryStr += ` AND p.campaign_id = @campaignId`;
            request.input('campaignId', sql.Int, campaignId);
        }

        queryStr += ` ORDER BY p.profile_id DESC`;

        const result = await request.query(queryStr);
        res.json({ success: true, count: result.recordset.length, profiles: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Duyệt hồ sơ (PUT /api/admission/profiles/:id/review)
exports.reviewProfile = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'Đạt yêu cầu', 'Không đạt', 'Cần bổ sung'

        if (!['Đạt yêu cầu', 'Không đạt', 'Cần bổ sung'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Trạng thái duyệt không hợp lệ!' });
        }

        const pool = await poolPromise;
        await pool.request()
            .input('profileId', sql.BigInt, id)
            .input('status', sql.NVarChar, status)
            .query(`UPDATE admission_profiles SET status = @status WHERE profile_id = @profileId`);

        await writeAuditLog(req.user?.user_id, 'REVIEW_ADMISSION_PROFILE', 'admission_profiles', id, null, { status }, req.ip);

        res.json({ success: true, message: `Đã cập nhật trạng thái hồ sơ thành: ${status}` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 6. Quyết định công nhận trúng tuyển & Cấp MSHV tự động (POST /api/admission/profiles/:id/admit)
exports.admitCandidate = async (req, res) => {
    try {
        const { id } = req.params;
        const { curriculumId = 1 } = req.body;

        const pool = await poolPromise;

        // 1. Kiểm tra hồ sơ
        const profileRes = await pool.request()
            .input('profileId', sql.BigInt, id)
            .query(`SELECT * FROM admission_profiles WHERE profile_id = @profileId`);

        if (profileRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ thí sinh!' });
        }

        const candidate = profileRes.recordset[0];

        // 2. Kiểm tra nếu đã nhập học rồi
        const existStudent = await pool.request()
            .input('profileId', sql.BigInt, id)
            .query(`SELECT student_code FROM students WHERE profile_id = @profileId`);

        if (existStudent.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Thí sinh này đã được cấp MSHV: ${existStudent.recordset[0].student_code}!`
            });
        }

        // 3. Tạo tài khoản User (Role STUDENT = 3)
        const username = `hv_${candidate.id_card_number.slice(-6)}`;
        const defaultPassword = 'AGU@' + candidate.id_card_number.slice(-4);
        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        const userInsert = await pool.request()
            .input('username', sql.VarChar, username)
            .input('passwordHash', sql.VarChar, passwordHash)
            .input('email', sql.VarChar, candidate.email)
            .input('roleId', sql.Int, 3)
            .query(`
                INSERT INTO users (username, password_hash, email, role_id, status)
                OUTPUT INSERTED.user_id
                VALUES (@username, @passwordHash, @email, @roleId, 'Active')
            `);

        const newUserId = userInsert.recordset[0].user_id;

        // 4. Sinh MSHV chuẩn AGU (Ví dụ: 26M + Mã Ngành + STT, hoặc 26M8480205 + STT)
        const yearPrefix = String(new Date().getFullYear()).slice(-2) + 'M';
        const studentCode = `${yearPrefix}8480205${String(candidate.profile_id).padStart(3, '0')}`;

        // 5. Thêm vào bảng students
        const studentInsert = await pool.request()
            .input('userId', sql.BigInt, newUserId)
            .input('studentCode', sql.VarChar, studentCode)
            .input('profileId', sql.BigInt, candidate.profile_id)
            .input('curriculumId', sql.Int, curriculumId)
            .query(`
                INSERT INTO students (user_id, student_code, profile_id, curriculum_id, academic_status, enrollment_date)
                OUTPUT INSERTED.student_id
                VALUES (@userId, @studentCode, @profileId, @curriculumId, N'Đang học', CAST(GETDATE() AS DATE))
            `);

        const newStudentId = studentInsert.recordset[0].student_id;

        // 6. Cập nhật trạng thái tuyển sinh
        await pool.request()
            .input('profileId', sql.BigInt, candidate.profile_id)
            .query(`UPDATE admission_profiles SET admission_status = N'Đã nhập học', status = N'Đạt yêu cầu' WHERE profile_id = @profileId`);

        // 7. Tạo học phí kỳ 1 mặc định (14.500.000 VNĐ)
        await pool.request()
            .input('studentId', sql.BigInt, newStudentId)
            .input('semesterId', sql.Int, 1)
            .input('baseAmount', sql.Decimal(12, 2), 14500000.00)
            .query(`
                INSERT INTO tuition_fees (student_id, semester_id, base_amount, due_date, paid_amount, status)
                VALUES (@studentId, @semesterId, @baseAmount, DATEADD(month, 1, GETDATE()), 0, N'Chưa thanh toán')
            `);

        // 8. Ghi Audit Log
        await writeAuditLog(req.user?.user_id, 'ADMIT_STUDENT', 'students', newStudentId, null, { studentCode, username }, req.ip);

        return res.status(201).json({
            success: true,
            message: 'Công nhận trúng tuyển & Cấp MSHV thành công!',
            data: {
                studentId: newStudentId,
                studentCode,
                username,
                temporaryPassword: defaultPassword,
                fullName: candidate.full_name
            }
        });
    } catch (err) {
        console.error('Lỗi khi nhập học thí sinh:', err);
        return res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
};
