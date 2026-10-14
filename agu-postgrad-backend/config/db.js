require('dotenv').config();
const sql = require('mssql/msnodesqlv8');

const primaryConnectionString = `Driver={${process.env.DB_DRIVER || 'ODBC Driver 18 for SQL Server'}};Server=${process.env.DB_SERVER || 'localhost'};Database=${process.env.DB_NAME || 'agu_postgrad_db'};Trusted_Connection=yes;TrustServerCertificate=yes;`;
const fallbackConnectionString = `Driver={${process.env.FALLBACK_DRIVER || 'SQL Server'}};Server=${process.env.DB_SERVER || 'localhost'};Database=${process.env.DB_NAME || 'agu_postgrad_db'};Trusted_Connection=yes;`;

const poolPromise = new sql.ConnectionPool({ connectionString: primaryConnectionString })
    .connect()
    .then(pool => {
        console.log('✅ [Database] Kết nối thành công tới SQL Server (agu_postgrad_db) qua Driver ODBC 18!');
        return pool;
    })
    .catch(err => {
        console.warn('⚠️ [Database] Lỗi kết nối Driver 18, chuyển sang Driver SQL Server mặc định...');
        return new sql.ConnectionPool({ connectionString: fallbackConnectionString })
            .connect()
            .then(pool => {
                console.log('✅ [Database] Kết nối thành công tới SQL Server qua Driver {SQL Server} mặc định!');
                return pool;
            })
            .catch(fallbackErr => {
                console.error('❌ [Database] Không thể kết nối SQL Server:', fallbackErr.message);
                throw fallbackErr;
            });
    });

// Helper ghi Audit Log nghiệp vụ nhạy cảm
async function writeAuditLog(userId, action, tableName, recordId, oldData, newData, ip) {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('userId', sql.BigInt, userId || null)
            .input('action', sql.NVarChar, action)
            .input('tableName', sql.VarChar, tableName)
            .input('recordId', sql.BigInt, recordId || null)
            .input('oldData', sql.NVarChar, oldData ? JSON.stringify(oldData) : null)
            .input('newData', sql.NVarChar, newData ? JSON.stringify(newData) : null)
            .input('ip', sql.VarChar, ip || '127.0.0.1')
            .query(`INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, ip_address)
                    VALUES (@userId, @action, @tableName, @recordId, @oldData, @newData, @ip)`);
    } catch (e) {
        console.error('Lỗi khi ghi Audit Log:', e.message);
    }
}

module.exports = {
    sql,
    poolPromise,
    writeAuditLog
};

