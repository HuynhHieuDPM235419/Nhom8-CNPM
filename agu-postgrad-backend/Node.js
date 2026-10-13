const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());

// =========================================================================
// 1. AUDIT LOG: Theo dõi việc cập nhật tiến độ luận văn, bảo mật dữ liệu
// =========================================================================
const auditLogMiddleware = (req, res, next) => {
    const logEntry = {
        action: 'UPDATE_THESIS_PROGRESS',
        user: req.headers['x-mshv'] || 'Unknown',
        role: req.headers['x-role'] || 'Student', // Phân quyền: Học viên hay CBHD
        timestamp: new Date().toISOString(),
        ip: req.ip,
        changes: {
            old_chapter: req.body.old_chapter || null,
            new_chapter: req.body.new_chapter || null
        }
    };

    console.log('[AUDIT LOG - ĐÀO TẠO SĐH]', JSON.stringify(logEntry));
    // Lưu vào database chuyên biệt cho log
    next();
};

app.post('/api/thesis/update-chapter', auditLogMiddleware, (req, res) => {
    res.json({ message: "Đã cập nhật tiến độ chương luận văn mới." });
});

// =========================================================================
// 2. MODULE UPLOAD FILE (Báo cáo chuyên đề, Draft Luận văn <= 25MB)
// =========================================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/theses/'),
    filename: (req, file, cb) => {
        // Tên file: MSHV-NgayThang-TenFile.pdf
        const mshv = req.headers['x-mshv'] || 'UNKNOWN';
        cb(null, `${mshv}-${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        // Chỉ nhận file văn bản hoặc nén cho tài liệu luận văn
        if (!file.originalname.match(/\.(pdf|doc|docx|zip|rar)$/)) {
            return cb(new Error('Chỉ cho phép upload file PDF, Word hoặc file nén (Zip/Rar).'));
        }
        cb(undefined, true);
    }
});

app.post('/api/thesis/upload-draft', upload.single('thesis_document'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Không tìm thấy file tài liệu' });
    res.json({ message: 'Nộp bản thảo luận văn thành công', file: req.file.filename });
});

// =========================================================================
// 3. MODULE REALTIME: Đăng ký Giảng viên Hướng dẫn & Cảnh báo hạn chót
// =========================================================================
// Quota (Chỉ tiêu) hướng dẫn của các Cán bộ hướng dẫn (CBHD) cho khóa này
let supervisorQuotas = {
    'TS_NGUYENVANA': 3, // Tiến sĩ A chỉ được nhận tối đa 3 học viên
    'PGS_TRANVANB': 5   // Phó Giáo sư B nhận tối đa 5 học viên
};

io.on('connection', (socket) => {
    console.log('Học viên / CBHD kết nối:', socket.id);

    // Xử lý đăng ký CBHD realtime để tránh tình trạng "tranh slot"
    socket.on('register_supervisor', (data) => {
        const { supervisorId, mshv } = data;

        if (supervisorQuotas[supervisorId] && supervisorQuotas[supervisorId] > 0) {
            supervisorQuotas[supervisorId] -= 1;

            // Broadcast đến TẤT CẢ học viên khác đang online trên cổng thông tin
            io.emit('supervisor_quota_updated', {
                supervisorId: supervisorId,
                slotsLeft: supervisorQuotas[supervisorId]
            });

            socket.emit('register_success', {
                message: `Đăng ký Cán bộ hướng dẫn ${supervisorId} thành công.`
            });
        } else {
            socket.emit('register_failed', {
                message: 'Cán bộ hướng dẫn này đã hết chỉ tiêu nhận học viên cao học.'
            });
        }
    });
});

// Cron Job: Chạy lúc 00:00 mỗi ngày để quét cảnh báo hạn bảo vệ luận văn
cron.schedule('0 0 * * *', () => {
    console.log('[CRON JOB] Quét thời hạn nộp lưu chiểu luận văn thạc sĩ...');

    // Giả lập danh sách học viên sắp hết hạn lưu chiểu (bảo vệ xong nhưng chưa nộp bản cứng)
    const warningList = [
        { mshv: 'CH24IT015', name: 'Trần C', deadline_days_left: 3 },
        { mshv: 'CH24IT021', name: 'Lê D', deadline_days_left: 1 }
    ];

    if (warningList.length > 0) {
        // Đẩy thông báo khẩn qua WebSocket cho Ban quản lý đào tạo SĐH
        io.emit('urgent_thesis_deadline', {
            message: 'CẢNH BÁO: Có học viên sắp trễ hạn nộp lưu chiểu luận văn!',
            data: warningList
        });
    }
});

server.listen(3001, () => {
    console.log('Node.js Microservice (Postgrad Mgt) chạy tại port 3001');
});