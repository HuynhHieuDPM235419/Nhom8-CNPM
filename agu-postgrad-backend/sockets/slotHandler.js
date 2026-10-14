const { sql, poolPromise } = require('../config/db');

function initSocketHandler(io) {
    io.on('connection', (socket) => {
        console.log('⚡ [Socket.IO] Client kết nối:', socket.id);

        // Lắng nghe sự kiện kích hoạt cập nhật Slot của Giảng viên
        socket.on('update_slot_trigger', async (lecturerId) => {
            try {
                const pool = await poolPromise;
                const result = await pool.request()
                    .input('lecId', sql.Int, lecturerId)
                    .query(`
                        SELECT 
                            l.lecturer_id,
                            l.max_slots,
                            COUNT(aa.advisor_assignment_id) AS current_assigned,
                            (l.max_slots - COUNT(aa.advisor_assignment_id)) AS slots_left
                        FROM lecturers l
                        LEFT JOIN advisor_assignments aa ON l.lecturer_id = aa.lecturer_id AND aa.status = N'Đang hướng dẫn'
                        WHERE l.lecturer_id = @lecId
                        GROUP BY l.lecturer_id, l.max_slots
                    `);

                if (result.recordset.length > 0) {
                    const data = result.recordset[0];
                    io.emit('slot_updated', {
                        lecturerId: data.lecturer_id,
                        maxSlots: data.max_slots,
                        currentAssigned: data.current_assigned,
                        slotsLeft: data.slots_left
                    });
                }
            } catch (err) {
                console.error('❌ [Socket.IO] Lỗi đếm slot GVHD:', err.message);
            }
        });

        socket.on('disconnect', () => {
            // Client ngắt kết nối
        });
    });
}

module.exports = { initSocketHandler };

