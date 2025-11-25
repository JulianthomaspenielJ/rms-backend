// models/feedbackModel.js
module.exports = {
  tableName: process.env.DDB_FEEDBACK_TABLE || 'tb_feedbacks',
  buildItem({ id, subject, message, ratings, created_at, created_by, updated_at, updated_by, feedback_status, status }) {
    return {
      id,
      subject,
      message,
      ratings,
      created_at,
      created_by,
      updated_at,
      updated_by,
      feedback_status: feedback_status ?? 'active',
      status: status ?? '1'
    };
  }
};
