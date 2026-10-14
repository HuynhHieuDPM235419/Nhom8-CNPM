const cron = require('node-cron');
const { poolPromise } = require('../config/db');

function initDeadlineReminderCron() {
    // Chạy tự động mỗi ngày lúc 00:00 (hoặc có thể test lúc khởi động)
    cron.schedule('0 0 * * *', async () => {
        console.log('🕒 [Cron] Đang quét cập nhật cảnh báo hạn chót luận văn (Xanh/Vàng/Đỏ)...');
        try {
            const pool = await poolPromise;

            // 1. Quá hạn chót mà chưa nộp -> Đỏ ('red')
            await pool.request().query(`
                UPDATE thesis_submissions 
                SET color_warning = 'red' 
                WHERE submitted_at IS NULL AND deadline < CAST(GETDATE() AS DATE)
            `);

            // 2. Còn <= 7 ngày mà chưa nộp -> Vàng ('yellow')
            await pool.request().query(`
                UPDATE thesis_submissions 
                SET color_warning = 'yellow' 
                WHERE submitted_at IS NULL 
                  AND deadline >= CAST(GETDATE() AS DATE) 
                  AND DATEDIFF(day, GETDATE(), deadline) <= 7
            `);

            // 3. Đã nộp hoặc còn > 7 ngày -> Xanh ('green')
            await pool.request().query(`
                UPDATE thesis_submissions 
                SET color_warning = 'green' 
                WHERE submitted_at IS NOT NULL OR DATEDIFF(day, GETDATE(), deadline) > 7
            `);

            console.log('✅ [Cron] Hoàn tất cập nhật trạng thái cảnh báo Xanh / Vàng / Đỏ!');
        } catch (err) {
            console.error('❌ [Cron] Lỗi khi quét hạn nộp luận văn:', err.message);
        }
    });

    console.log('🕒 [Cron Job] Đã kích hoạt lịch trình tự động quét deadline hàng ngày');
}

module.exports = { initDeadlineReminderCron };

