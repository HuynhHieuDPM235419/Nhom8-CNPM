const { sql, poolPromise, writeAuditLog } = require('../config/db');
const crypto = require('crypto');

// 1. Lấy danh sách đợt khảo sát QA đang mở (GET /api/surveys/active)
exports.getActiveSurveys = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                c.campaign_id,
                c.template_id,
                c.class_id,
                c.start_date,
                c.end_date,
                t.title AS survey_title,
                t.survey_type,
                cls.class_name
            FROM qa_survey_campaigns c
            JOIN qa_survey_templates t ON c.template_id = t.template_id
            LEFT JOIN course_classes cls ON c.class_id = cls.class_id
            WHERE c.start_date <= GETDATE() AND c.end_date >= GETDATE()
              AND t.is_published = 1
        `);
        res.json({ success: true, campaigns: result.recordset });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Lấy bộ câu hỏi của một đợt khảo sát (GET /api/surveys/:campaignId/questions)
exports.getSurveyQuestions = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const pool = await poolPromise;

        const campaignRes = await pool.request()
            .input('cId', sql.Int, campaignId)
            .query(`
                SELECT c.campaign_id, t.template_id, t.title, t.survey_type
                FROM qa_survey_campaigns c
                JOIN qa_survey_templates t ON c.template_id = t.template_id
                WHERE c.campaign_id = @cId
            `);

        if (campaignRes.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Đợt khảo sát không tồn tại!' });
        }

        const templateId = campaignRes.recordset[0].template_id;
        const questionsRes = await pool.request()
            .input('tId', sql.Int, templateId)
            .query(`
                SELECT question_id, question_text, scale_type
                FROM qa_survey_questions
                WHERE template_id = @tId
                ORDER BY question_id ASC
            `);

        res.json({
            success: true,
            survey: campaignRes.recordset[0],
            questions: questionsRes.recordset
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Nộp kết quả khảo sát ẩn danh (POST /api/surveys/submit)
// Lưu trữ bằng anonymous_token để đảm bảo tính khách quan của QA
exports.submitSurveyResponse = async (req, res) => {
    try {
        const { campaignId, answers } = req.body;
        // answers dạng mảng: [ { questionId: 1, ratingScore: 5 }, { questionId: 2, ratingScore: 4 } ]

        if (!campaignId || !answers || !Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({ success: false, message: 'Thiếu dữ liệu câu trả lời khảo sát!' });
        }

        const pool = await poolPromise;
        const anonymousToken = crypto.randomBytes(32).toString('hex');

        // Tạo bản ghi response ẩn danh
        const respInsert = await pool.request()
            .input('cId', sql.Int, campaignId)
            .input('token', sql.VarChar, anonymousToken)
            .query(`
                INSERT INTO qa_survey_responses (campaign_id, anonymous_token)
                OUTPUT INSERTED.response_id
                VALUES (@cId, @token)
            `);

        const responseId = respInsert.recordset[0].response_id;

        // Lưu chi tiết từng câu trả lời (thang Likert 1-5)
        for (const ans of answers) {
            const score = parseInt(ans.ratingScore);
            if (score >= 1 && score <= 5) {
                await pool.request()
                    .input('respId', sql.BigInt, responseId)
                    .input('qId', sql.Int, ans.questionId)
                    .input('score', sql.Int, score)
                    .query(`
                        INSERT INTO qa_survey_details (response_id, question_id, rating_score)
                        VALUES (@respId, @qId, @score)
                    `);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Cảm ơn bạn đã đóng góp ý kiến! Phiếu khảo sát đã được ghi nhận ẩn danh.'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 4. Thống kê điểm khảo sát phục vụ Phòng Đảm bảo chất lượng (GET /api/surveys/statistics/:campaignId)
exports.getSurveyStatistics = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const pool = await poolPromise;

        const totalRes = await pool.request()
            .input('cId', sql.Int, campaignId)
            .query(`SELECT COUNT(*) AS total_responses FROM qa_survey_responses WHERE campaign_id = @cId`);

        const statsRes = await pool.request()
            .input('cId', sql.Int, campaignId)
            .query(`
                SELECT 
                    q.question_id,
                    q.question_text,
                    COUNT(d.detail_id) AS total_answers,
                    ROUND(AVG(CAST(d.rating_score AS FLOAT)), 2) AS average_score
                FROM qa_survey_questions q
                JOIN qa_survey_campaigns c ON q.template_id = c.template_id
                LEFT JOIN qa_survey_responses r ON c.campaign_id = r.campaign_id
                LEFT JOIN qa_survey_details d ON r.response_id = d.response_id AND q.question_id = d.question_id
                WHERE c.campaign_id = @cId
                GROUP BY q.question_id, q.question_text
                ORDER BY q.question_id ASC
            `);

        res.json({
            success: true,
            campaignId,
            totalResponses: totalRes.recordset[0].total_responses,
            questionsSummary: statsRes.recordset
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

