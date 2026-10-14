const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'Không tìm thấy Token xác thực (Authorization header missing)!' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'AGU_POSTGRAD_SECRET_KEY_2026_DHAG');
        req.user = decoded; // { user_id, username, email, role_id, role_code, lecturer_id, student_id }
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn!' });
    }
};

const requireRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role_code)) {
            return res.status(403).json({ 
                success: false, 
                message: `Truy cập bị từ chối! Yêu cầu vai trò: [${allowedRoles.join(', ')}]` 
            });
        }
        next();
    };
};

module.exports = {
    verifyToken,
    requireRoles
};

