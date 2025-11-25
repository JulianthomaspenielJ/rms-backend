// models/companyModel.js
module.exports = {
  tableName: process.env.DDB_COMPANY_TABLE || 'tb_company',
  buildItem({ id, email_address, company_size, company_location, company_name, created_at, created_by, updated_at, updated_by, status, active_status }) {
    return {
      id,
      email_address,
      company_size,
      company_location,
      company_name,
      created_at,
      created_by,
      updated_at,
      updated_by,
      status,
      active_status: active_status ?? 'Active'
    };
  }
};


