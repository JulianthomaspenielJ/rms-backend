// models/userModel.js
module.exports = {
  tableName: process.env.DDB_USERS_TABLE || 'tb_users',
  buildItem({ id, full_name, email_address, company_id, created_at, created_by, updated_at, updated_by, user_role, status, password, active_status }) {
    return {
      id,
      full_name,
      email_address,
      company_id,
      created_at,
      created_by,
      updated_at,
      updated_by,
      user_role,
      status,
      active_status: active_status ?? 'Active',
      ...(password ? { password } : {})
    };
  }
};


