// models/resumeModel.js
module.exports = {
  tableName: process.env.DDB_RESUME_TABLE || 'tb_resume',
  buildItem({ id, created_at, created_by, hr_id, jd_id, resume_url, status, updated_at, updated_by }) {
    return {
      id,
      created_at,
      created_by,
      hr_id,
      jd_id,
      resume_url,
      status: status ?? 1,
      updated_at,
      updated_by
    };
  }
};
