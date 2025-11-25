// models/loginLogModel.js
module.exports = {
  tableName: process.env.DDB_LOGIN_LOGS_TABLE || 'tb_login_log',
  // Support tables keyed by either 'id' or 'user_id'
  buildItem({ id, user_id, login_at, email_address, token, user_role, status, created_at, created_by, updated_at, updated_by }) {
    return {
      ...(id ? { id } : {}),
      ...(user_id ? { user_id } : {}),
      login_at,
      email_address,
      token,
      user_role,
      status,
      created_at,
      created_by,
      updated_at,
      updated_by
    };
  }
};
