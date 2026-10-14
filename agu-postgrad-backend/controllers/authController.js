const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, poolPromise, writeAuditLog } = require('../config/db');

// 1. Đăng nhập hệ thống (POST /api/auth/login)
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập/email và mật khẩu!' });
        }

        const pool = await poolPromise;
        const result = await pool.request()
            .input('loginIdentifier', sql.VarChar, username.trim())
            .query(`
                SELECT u.user_id, u.username, u.password_hash, u.email, u.status,
                       r.role_id, r.role_code, r.role_name
                FROM users u
                JOIN roles r ON u.role_id = r.role_id
                WHERE u.username = @loginIdentifier OR u.email = @loginIdentifier
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({ success: false, message: 'Tài khoản không tồn tại trong hệ thống!' });
        }

        const user = result.recordset[0];

        if (user.status !== 'Active') {
            return res.status(403).json({ success: false, message: 'Tài khoản đã bị khóa hoặc chưa kích hoạt!' });
        }

        // Kiểm tra mật khẩu (hỗ trợ hash bcrypt hoặc mật khẩu seed mẫu)
        let isMatch = false;
        if (user.password_hash === '$2b$10$hashedpasswordsample' && password === '123456') {
            isMatch = true;
        } else if (user.password_hash === password) {
            isMatch = true;
        } else {
            isMatch = await bcrypt.compare(password, user.password_hash);
        }

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
        }

        // Lấy thêm thông tin cụ thể theo Role (Giảng viên hoặc Học viên)
        let lecturerInfo = null;
        let studentInfo = null;

        if (user.role_code === 'LECTURER') {
            const lecResult = await pool.request()
                .input('userId', sql.BigInt, user.user_id)
                .query(`SELECT lecturer_id, lecturer_code, full_name, degree, max_slots FROM lecturers WHERE user_id = @userId`);
            if (lecResult.recordset.length > 0) lecturerInfo = lecResult.recordset[0];
        } else if (user.role_code === 'STUDENT') {
            const stuResult = await pool.request()
                .input('userId', sql.BigInt, user.user_id)
                .query(`
                    SELECT s.student_id, s.student_code, s.academic_status, p.full_name, p.phone
                    FROM students s
                    JOIN admission_profiles p ON s.profile_id = p.profile_id
                    WHERE s.user_id = @userId
                `);
            if (stuResult.recordset.length > 0) studentInfo = stuResult.recordset[0];
        }

        const displayName = lecturerInfo?.full_name || studentInfo?.full_name || user.username;
        const lecturerId = lecturerInfo?.lecturer_id || null;
        const studentId = studentInfo?.student_id || null;

        const tokenPayload = {
            user_id: user.user_id,
            username: user.username,
            email: user.email,
            role_id: user.role_id,
            role_code: user.role_code,
            displayName,
            lecturer_id: lecturerId,
            student_id: studentId
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET || 'AGU_POSTGRAD_SECRET_KEY_2026_DHAG', {
            expiresIn: '7d'
        });

        // Ghi Audit Log đăng nhập
        await writeAuditLog(user.user_id, 'USER_LOGIN', 'users', user.user_id, null, { loginTime: new Date() }, req.ip);

        return res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            token,
            user: {
                userId: user.user_id,
                username: user.username,
                email: user.email,
                roleCode: user.role_code,
                roleName: user.role_name,
                displayName,
                lecturer: lecturerInfo,
                student: studentInfo
            }
        });
    } catch (err) {
        console.error('Lỗi API Login:', err);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ: ' + err.message });
    }
};

// 2. Lấy thông tin cá nhân (GET /api/auth/profile)
exports.getProfile = async (req, res) => {
    try {
        const pool = await poolPromise;
        const userResult = await pool.request()
            .input('userId', sql.BigInt, req.user.user_id)
            .query(`
                SELECT u.user_id, u.username, u.email, u.status, u.created_at,
                       r.role_code, r.role_name
                FROM users u
                JOIN roles r ON u.role_id = r.role_id
                WHERE u.user_id = @userId
            `);

        if (userResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng!' });
        }

        return res.json({ success: true, profile: { ...userResult.recordset[0], ...req.user } });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Đổi mật khẩu (PUT /api/auth/change-password)
exports.changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự!' });
        }

        const pool = await poolPromise;
        const userRes = await pool.request()
            .input('userId', sql.BigInt, req.user.user_id)
            .query(`SELECT password_hash FROM users WHERE user_id = @userId`);

        const currentHash = userRes.recordset[0].password_hash;
        let isMatch = false;
        if (currentHash === '$2b$10$hashedpasswordsample' && oldPassword === '123456') {
            isMatch = true;
        } else if (currentHash === oldPassword) {
            isMatch = true;
        } else {
            isMatch = await bcrypt.compare(oldPassword, currentHash);
        }

        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Mật khẩu cũ không chính xác!' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.request()
            .input('userId', sql.BigInt, req.user.user_id)
            .input('newHash', sql.VarChar, newHash)
            .query(`UPDATE users SET password_hash = @newHash WHERE user_id = @userId`);

        await writeAuditLog(req.user.user_id, 'CHANGE_PASSWORD', 'users', req.user.user_id, null, null, req.ip);

        return res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Lấy thông báo (GET /api/notifications)
exports.getNotifications = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('userId', sql.BigInt, req.user.user_id)
            .input('roleId', sql.Int, req.user.role_id)
            .query(`
                SELECT notification_id, title, content, is_read, created_at
                FROM notifications
                WHERE (target_user_id = @userId) 
                   OR (target_role_id = @roleId AND target_user_id IS NULL)
                   OR (target_user_id IS NULL AND target_role_id IS NULL)
                ORDER BY created_at DESC
            `);
        return res.json({ success: true, notifications: result.recordset });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Đánh dấu đã đọc thông báo (PUT /api/notifications/:id/read)
exports.markNotificationRead = async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('notifId', sql.BigInt, req.params.id)
            .query(`UPDATE notifications SET is_read = 1 WHERE notification_id = @notifId`);
        return res.json({ success: true, message: 'Đã cập nhật trạng thái thông báo' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

