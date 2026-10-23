require('dotenv').config(); //s
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

// 1. Khởi tạo ứng dụng & Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});

// Lưu instance io vào app để các controller có thể emit sự kiện
app.set('io', io);

// 2. Middlewares toàn cục
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Static phục vụ các file upload (Báo cáo luận văn, Minh chứng bài báo, Chứng chỉ ngoại ngữ...)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 3. Khởi tạo Database Connection Pool
const { poolPromise } = require('./config/db');

// 4. Đăng ký các Route API theo 7 Phân hệ nghiệp vụ
const authRoutes = require('./routes/authRoutes');
const admissionRoutes = require('./routes/admissionRoutes');
const academicRoutes = require('./routes/academicRoutes');
const studentRoutes = require('./routes/studentRoutes');
const thesisRoutes = require('./routes/thesisRoutes');
const committeeRoutes = require('./routes/committeeRoutes');
const surveyRoutes = require('./routes/surveyRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/admission', admissionRoutes);
app.use('/api/academic', academicRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/thesis', thesisRoutes);
app.use('/api/committee', committeeRoutes);
app.use('/api/surveys', surveyRoutes);

// Health-check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'AGU Postgraduate Management System (Master Degree)',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// 5. Khởi tạo Realtime Socket.IO & Cron Job cảnh báo hạn chót
const { initSocketHandler } = require('./sockets/slotHandler');
const { initDeadlineReminderCron } = require('./jobs/deadlineReminder');

initSocketHandler(io);
initDeadlineReminderCron();

// 6. Middleware xử lý lỗi tập trung
app.use((err, req, res, next) => {
    console.error('💥 [Server Error]:', err.stack || err.message);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Lỗi xử lý yêu cầu trên máy chủ!'
    });
});

// 7. Lắng nghe trên cổng chỉ định (Mặc định: 5000)
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(`🎓 HỆ THỐNG QUẢN LÝ ĐÀO TẠO SAU ĐẠI HỌC - AGU MASTER SYSTEM`);
    console.log(`🚀 Máy chủ Backend đang lắng nghe tại: http://localhost:${PORT}`);
    console.log(`📡 WebSocket Realtime: Sẵn sàng trên cổng ${PORT}`);
    console.log(`==================================================================`);
});
