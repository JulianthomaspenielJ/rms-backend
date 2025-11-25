// models/shortlistModel.js
module.exports = {
  tableName: process.env.DDB_SHORTLIST_TABLE || 'tb_shortlist',
  buildItem({ id, created_at, created_by, updated_at, updated_by, status, hr_id, jd_id, candidate_id, stage, remarks }) {
    return {
      id,
      created_at,
      created_by,
      updated_at,
      updated_by,
      status: status ?? '1',
      hr_id,
      jd_id,
      candidate_id,
      stage, // e.g., 'applied', 'shortlisted', 'interview', 'hired', 'rejected'
      remarks
    };
  }
};


