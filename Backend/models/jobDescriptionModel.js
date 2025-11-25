// models/jobDescriptionModel.js
module.exports = {
  tableName: process.env.DDB_JOB_DESCRIPTIONS_TABLE || 'tb_job_descriptions',
  buildItem({ id, created_at, created_by, hr_id, jd_department, jd_title, jd_url, status, updated_at, updated_by }) {
    return {
      id,
      created_at,
      created_by,
      hr_id,
      jd_department,
      jd_title,
      jd_url,
      status: status ?? 1,
      updated_at,
      updated_by
    };
  }
};
